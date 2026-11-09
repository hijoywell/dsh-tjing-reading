// Run with tabbit-cli nodejs --task "Test ebook formats" < this file.
// Optional public-domain Gutenberg fixtures: %TEMP%/dsh-format-check/alice.{mobi,azw3}.
const fs = await import('node:fs/promises');
const os = await import('node:os');
const path = await import('node:path');
const { pathToFileURL } = await import('node:url');
const root = process.cwd();
const source = await fs.readFile(path.join(root, 'client.js'), 'utf8');
const start = source.indexOf('    // BEGIN GENERATED BOOK FORMATS');
const end = source.indexOf('    // END GENERATED BOOK FORMATS', start);
assert.ok(start >= 0 && end > start);
const engine = source.slice(start, end);
const helpers = source.slice(source.indexOf('    function dirname('), source.indexOf('    function parseXml('));
const htmlStart = source.indexOf('    async function chapterHtml(');
const htmlEnd = source.indexOf('    /* ------------------------------------------------------------------ *', htmlStart);
const renderer = helpers + '\n' + source.slice(htmlStart, htmlEnd);
const fixtureModule = await import(pathToFileURL(path.join(root, 'tests/mobi-fixtures.js')).href);
const fixtures = [
  { name: 'fixture.mobi', bytes: [...new Uint8Array(fixtureModule.mobiFixture({withImage:true}))] },
  { name: 'palmdoc.mobi', bytes: [...new Uint8Array(fixtureModule.mobiFixture({compressed:true}))] },
];
for (const name of ['alice.mobi','alice.azw3']) {
  try { fixtures.push({name,bytes:[...await fs.readFile(path.join(os.tmpdir(),'dsh-format-check',name))]}); }
  catch { /* The generated MOBI fixtures still run without a network download. */ }
}
await page.goto('about:blank');
const result = await page.evaluate(async ({engine,renderer,fixtures}) => {
  const formats = new Function(engine + '\nreturn BOOK_FORMATS;')();
  const chapterHtml = new Function(renderer + '\nreturn chapterHtml;')();
  const results = [];
  const assert = (ok,message) => { if (!ok) throw new Error(message); };
  for (const fixture of fixtures) {
    const book = await formats.parseMobiBook(new Uint8Array(fixture.bytes).buffer, fixture.name, i=>`Chapter ${i+1}`);
    try {
      assert(book.chapters.length > 0, fixture.name+': empty chapters');
      assert(book.toc.length > 0, fixture.name+': missing TOC');
      let chars=0, images=0, anchors=0;
      const indexes = book.chapters.length <= 50 ? book.chapters.map((_, index) => index)
        : [...new Set([0,Math.min(1,book.chapters.length-1),book.chapters.length-1])];
      for (const index of indexes) {
        const html = await chapterHtml(book,index,[]);
        const doc = new DOMParser().parseFromString(html,'text/html');
        assert(!doc.querySelector('script,iframe,object'), 'unsafe content');
        chars += doc.body.textContent.length;
        for (const img of doc.querySelectorAll('img[src^="blob:"]')) {
          const blob = await (await fetch(img.getAttribute('src'))).blob();
          assert(blob.size > 0,'missing embedded image'); images++;
        }
        for (const row of book.toc.filter(row=>row.chapter===index && row.fragment)) {
          if (doc.getElementById(row.fragment)) anchors++;
        }
      }
      assert(chars > 10,fixture.name+': no text');
      if (fixture.name === 'fixture.mobi') assert(images > 0, 'MOBI embedded image was dropped');
      results.push({name:fixture.name,title:book.title,chapters:book.chapters.length,toc:book.toc.length,chars,images,anchors});
    } finally { book.destroy(); }
  }
  const book = formats.parseTextBook(new TextEncoder().encode('第一章 开始\n\n你好 <script>alert(1)</script>\n\n第二章 继续\n\n另一个段落。'),'中文测试.txt',i=>`第${i+1}章`);
  assert(book.title==='中文测试','TXT title');
  assert(book.chapters.length===2,'TXT chapter count');
  for(let i=0;i<book.chapters.length;i++) {
    assert(book.chapterIndex.get(book.chapters[i])===i,'TXT path index');
    const html=await chapterHtml(book,i,[]);
    const doc=new DOMParser().parseFromString(html,'text/html');
    assert(doc.body.textContent.trim(),'TXT blank chapter');
    assert(!doc.querySelector('script'),'TXT XSS');
  }
  results.push({name:'中文测试.txt',title:book.title,chapters:book.chapters.length});
  return results;
}, {engine,renderer,fixtures});
return result;
