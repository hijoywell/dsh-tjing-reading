// Regression: the highlight swatches overlap by half and the hovered one lifts.
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
const markup = `<!doctype html><meta charset="utf-8"><style>${css}
body{margin:0;background:#c7edcc;font-family:system-ui}
.wrap{padding:40px 30px}</style>
<style>/* Host-like global button reset, loaded after the plugin sheet. */
button{border-radius:8px;border:.5px solid #ccc;padding:4px 10px;background:0 0}</style>
<div class="wrap"><div class="bk-selbar" style="position:static;transform:none">
${['#f2cd55', '#7cc596', '#7cb0ee', '#ee97b4'].map((color, i) => `<button type="button" class="bk-swatch${i === 1 ? ' bk-on' : ''}" style="background:${color}" aria-label="c${i}"></button>`).join('')}
<span class="bk-selbar-sep"></span><button class="bk-selbtn" type="button">想法</button></div></div>`;
const profile = await mkdtemp(join(tmpdir(), 'dsh-swatch-browser-'));
const child = spawn(process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless', '--disable-gpu', '--no-first-run', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
let ws;
const timer = setTimeout(() => { child.kill(); console.error('Swatch test timed out'); process.exitCode = 1; }, 60000);
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
  await send('Emulation.setDeviceMetricsOverride', { width: 420, height: 150, deviceScaleFactor: 1, mobile: false }, sessionId);
  await send('Page.enable', {}, sessionId);
  await send('Page.navigate', { url: 'data:text/html;charset=utf-8,' + encodeURIComponent(markup) }, sessionId);
  for (let i = 0; i < 100; i++) {
    const ready = await send('Runtime.evaluate', { expression: 'document.querySelectorAll(".bk-swatch").length === 4', returnByValue: true }, sessionId);
    if (ready.result.value) break;
    await delay(50);
  }
  const geometry = await send('Runtime.evaluate', {
    expression: `(() => [...document.querySelectorAll('.bk-swatch')].map(el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, z: getComputedStyle(el).zIndex }; }))()`,
    returnByValue: true,
  }, sessionId);
  const boxes = geometry.result.value;
  assert.equal(boxes.length, 4);
  for (const box of boxes) { assert.ok(Math.abs(box.w - 24) < 0.6 && Math.abs(box.h - 24) < 0.6, 'swatch is not a 24px circle'); }
  // Shape must survive a host button reset: clip-path, not border-radius alone.
  const shape = await send('Runtime.evaluate', {
    expression: `(() => { const s = getComputedStyle(document.querySelectorAll('.bk-swatch')[0]); return { clip: s.clipPath, radius: s.borderRadius }; })()`,
    returnByValue: true,
  }, sessionId);
  assert.match(String(shape.result.value.clip), /circle\(50%/, `clip-path missing: ${shape.result.value.clip}`);
  assert.equal(shape.result.value.radius, '50%');
  const overlap = boxes[0].x + boxes[0].w - boxes[1].x;
  assert.ok(Math.abs(overlap - 12) < 1, `expected half overlap (12px), got ${overlap}`);
  for (let i = 1; i < boxes.length; i++) assert.ok(boxes[i].x > boxes[i - 1].x, 'swatches are not in a row');
  const before = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
  await writeFile(join(tmpdir(), 'dsh-swatch-rest.png'), Buffer.from(before.data, 'base64'));
  // Hover the last swatch (fully exposed) and the first one (left half exposed):
  // both must lift above the stack and grow. A raised active colour must never
  // swallow a neighbour's clickable half.
  const last = boxes[3];
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: last.x + 12, y: last.y + last.h / 2, button: 'none', buttons: 0 }, sessionId);
  await delay(260);
  const hoverLast = await send('Runtime.evaluate', {
    expression: `(() => { const el = document.querySelectorAll('.bk-swatch')[3]; const s = getComputedStyle(el); return { transform: s.transform, z: s.zIndex, width: el.getBoundingClientRect().width }; })()`,
    returnByValue: true,
  }, sessionId);
  const target = boxes[2];
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: target.x + 6, y: target.y + target.h / 2, button: 'none', buttons: 0 }, sessionId);
  await delay(260);
  const hover = await send('Runtime.evaluate', {
    expression: `(() => { const el = document.querySelectorAll('.bk-swatch')[2]; const s = getComputedStyle(el); return { transform: s.transform, z: s.zIndex, width: el.getBoundingClientRect().width }; })()`,
    returnByValue: true,
  }, sessionId);
  const state = hover.result.value;
  assert.ok(state.transform !== 'none', 'hover did not scale the swatch');
  assert.ok(Number(state.z) >= 4, `hovered swatch z-index is ${state.z}`);
  assert.ok(state.width > 26, `hovered swatch did not grow: ${state.width}`);
  assert.ok(hoverLast.result.value.transform !== 'none', 'last swatch did not lift');
  assert.ok(hoverLast.result.value.width > 26, 'last swatch did not grow');
  const after = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
  const hoverShot = join(tmpdir(), 'dsh-swatch-hover.png');
  await writeFile(hoverShot, Buffer.from(after.data, 'base64'));
  console.log(`PASS overlap=${overlap}px hover=${state.transform} z=${state.z} width=${state.width}`);
  console.log('rest=' + join(tmpdir(), 'dsh-swatch-rest.png'));
  console.log('hover=' + hoverShot);
  await send('Browser.close');
} finally { clearTimeout(timer); ws?.close(); child.kill(); }
