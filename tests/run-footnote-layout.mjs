// Regression: footnote markers become buttons, entries become a quieter block.
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { once } from 'node:events';
import assert from 'node:assert/strict';
const root = new URL('../', import.meta.url);
const source = await readFile(new URL('client.js', root), 'utf8');
const css = new Function('CODE_STACK', source.slice(source.indexOf('    const BOOK_STYLES = `'), source.indexOf('    const STYLE_NODE =')) + '\nreturn BOOK_STYLES;')('monospace');
const helpers = source.slice(source.indexOf('    function dirname('), source.indexOf('    function parseXml('));
const start = source.indexOf('    async function chapterHtml(');
const end = source.indexOf('    /* ------------------------------------------------------------------ *', start);
assert.ok(start > 0 && end > start);
const renderer = helpers + '\n' + source.slice(start, end);
const chapter = `<html><body>
<h1>农民问题的严重性</h1>
<p>我这次回到湖南[1]，实地考察了湘潭、湘乡、衡山、醴陵、长沙五县的情况。这一点见[9]号文件，没有对应条目。</p>
<p>第二段正文，引用另一个注记〔2〕，还有圈号①。</p>
<p>[1]湖南是当时全国农民运动的中心。</p>
<p>〔2〕这里的统计数字引自当时的农会报告。</p>
<p>① 圈号形式的注释条目。</p>
</body></html>`;
const markup = `<!doctype html><meta charset="utf-8"><style>${css}
body{margin:0;background:#c7edcc}
.wrap{padding:26px 30px;max-width:620px;font-size:17px;line-height:1.9;--bk-muted:#5a6b5c;--bk-accent:#2f6f4f;--bk-barBorder:rgba(44,51,44,.12)}
</style><div class="wrap"><div class="bk-content" id="mount"></div></div>`;
const profile = await mkdtemp(join(tmpdir(), 'dsh-footnote-browser-'));
const child = spawn(process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless', '--disable-gpu', '--no-first-run', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
let ws;
const timer = setTimeout(() => { child.kill(); console.error('Footnote test timed out'); process.exitCode = 1; }, 60000);
try {
  let info;
  for (let i = 0; i < 200; i++) { try { info = await readFile(join(profile, 'DevToolsActivePort'), 'utf8'); break; } catch { await delay(50); } }
  if (!info) throw Error('Chrome endpoint unavailable');
  const [port, url] = info.trim().split(/\r?\n/);
  ws = new WebSocket(`ws://127.0.0.1:${port}${url}`);
  await once(ws, 'open');
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (event) => { const msg = JSON.parse(event.data); const job = pending.get(msg.id); if (job) { pending.delete(msg.id); msg.error ? job.reject(Error(JSON.stringify(msg.error))) : job.resolve(msg.result); } });
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => { const next = ++id; pending.set(next, { resolve, reject }); ws.send(JSON.stringify({ id: next, method, params, sessionId })); });
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  await send('Emulation.setDeviceMetricsOverride', { width: 700, height: 620, deviceScaleFactor: 1, mobile: false }, sessionId);
  await send('Page.navigate', { url: 'data:text/html;charset=utf-8,' + encodeURIComponent(markup) }, sessionId);
  for (let i = 0; i < 100; i++) {
    const ready = await send('Runtime.evaluate', { expression: '!!document.getElementById("mount")', returnByValue: true }, sessionId);
    if (ready.result.value) break;
    await delay(50);
  }
  const result = await send('Runtime.evaluate', {
    expression: `(async () => {
      const chapterHtml = new Function(${JSON.stringify(renderer)} + '\\nreturn chapterHtml;')();
      const bytes = new TextEncoder().encode(${JSON.stringify(chapter)});
      const book = { chapters: ['c.html'], chapterIndex: new Map([['c.html', 0]]), zip: { entry: async () => bytes, text: async () => ${JSON.stringify(chapter)} } };
      const html = await chapterHtml(book, 0, []);
      const mount = document.getElementById('mount');
      mount.innerHTML = html;
      const refs = [...mount.querySelectorAll('.bk-fnref')];
      const notes = [...mount.querySelectorAll('.bk-fn')];
      const body = mount.querySelector('p');
      const bodySize = parseFloat(getComputedStyle(body).fontSize);
      const noteSize = notes.length ? parseFloat(getComputedStyle(notes[0]).fontSize) : 0;
      const noteFamily = notes.length ? getComputedStyle(notes[0]).fontFamily : '';
      return {
        refs: refs.map((el) => ({ label: el.textContent, target: el.getAttribute('data-fn'), exists: !!document.getElementById(el.getAttribute('data-fn')) })),
        notes: notes.map((el) => ({ id: el.id, text: el.textContent.slice(0, 24) })),
        bodySize, noteSize, noteFamily,
        leftover: mount.textContent.includes('[9]'),
        html,
      };
    })()`,
    awaitPromise: true,
    returnByValue: true,
  }, sessionId);
  if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  const data = result.result.value;
  assert.equal(data.refs.length, 3, `expected 3 footnote refs, got ${data.refs.length}`);
  assert.deepEqual(data.refs.map((r) => r.label), ['[1]', '〔2〕', '①']);
  for (const ref of data.refs) assert.ok(ref.exists, `dangling footnote ref ${ref.label}`);
  assert.equal(data.notes.length, 3);
  assert.ok(data.noteSize < data.bodySize * 0.9, `note text is not smaller: ${data.noteSize} vs ${data.bodySize}`);
  assert.match(data.noteFamily, /serif/i, `note font is not serif: ${data.noteFamily}`);
  assert.ok(data.leftover, 'a bracket number without an entry must stay plain text');
  await send('Runtime.evaluate', { expression: 'document.fonts.ready', awaitPromise: true }, sessionId);
  // Render the bubble the way the reader does: dark card, arrow at the marker.
  const bubble = await send('Runtime.evaluate', {
    expression: `(() => {
      const ref = document.querySelector('.bk-fnref');
      const rect = ref.getBoundingClientRect();
      const card = document.createElement('div');
      card.className = 'bk-fnpop bk-fnpop-below';
      card.dataset.arrow = 'center';
      card.style.left = (rect.left + rect.width / 2) + 'px';
      card.style.top = (rect.bottom + 10) + 'px';
      card.style.transform = 'translate(-50%, 0)';
      card.innerHTML = '<div class="bk-fnpop-body">湖南是当时全国农民运动的中心。</div>';
      document.body.append(card);
      const s = getComputedStyle(card);
      const body = getComputedStyle(card.querySelector('.bk-fnpop-body'));
      const arrow = getComputedStyle(card, '::after');
      return { background: s.backgroundColor, color: s.color, font: s.fontFamily, fontSize: body.fontSize, arrowTop: arrow.top, arrowColor: arrow.borderBottomColor };
    })()`,
    returnByValue: true,
  }, sessionId);
  const pop = bubble.result.value;
  assert.equal(pop.background, 'rgb(58, 58, 60)', `bubble background: ${pop.background}`);
  assert.match(pop.font, /system-ui/i, `bubble font is not the system stack: ${pop.font}`);
  assert.ok(parseFloat(pop.fontSize) >= 13.5, `bubble text too small: ${pop.fontSize}`);
  assert.equal(pop.arrowTop, '-14px', `arrow missing: top=${pop.arrowTop}`);
  // Let the fade-in finish before capturing, otherwise the card looks washed out.
  await delay(320);
  const shot = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
  const output = join(tmpdir(), 'dsh-footnote-preview.png');
  await writeFile(output, Buffer.from(shot.data, 'base64'));
  console.log(`PASS refs=${data.refs.length} notes=${data.notes.length} body=${data.bodySize}px note=${data.noteSize}px bubble=${pop.background}/${pop.fontSize}`);
  console.log('screenshot=' + output);
  await send('Browser.close');
} finally { clearTimeout(timer); ws?.close(); child.kill(); }
