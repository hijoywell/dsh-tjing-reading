import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTextBook } from '../src/text-book.js';

const utf8 = (s) => new TextEncoder().encode(s);
const utf16 = (s, be = false) => Uint8Array.from([
  be ? 0xfe : 0xff, be ? 0xff : 0xfe,
  ...[...s].flatMap((c) => { const v = c.charCodeAt(0); return be ? [v >> 8, v & 0xff] : [v & 0xff, v >> 8]; }),
]);
// GB18030 double-byte encodings for the few characters the fixtures need.
const GB = {
  第: [0xb5, 0xda], 一: [0xd2, 0xbb], 章: [0xd5, 0xc2], 夜: [0xd2, 0xb9], 航: [0xba, 0xbd],
  晚: [0xcd, 0xed], 上: [0xc9, 0xcf], 甲: [0xbc, 0xd7], 板: [0xb0, 0xe5], 湿: [0xca, 0xaa],
  归: [0xb9, 0xe9], 港: [0xb8, 0xdb], 天: [0xcc, 0xec], 亮: [0xc1, 0xc1], 了: [0xc1, 0xcb],
  长: [0xb3, 0xa4], 风: [0xb7, 0xe7], 起: [0xc6, 0xf0],
};
const gbk = (s) => Uint8Array.from([...s].flatMap((c) => GB[c] ?? [/[\x00-\x7f]/.test(c) ? [c.charCodeAt(0)] : []]));
const labels = (i) => `第 ${i + 1} 节`;

test('reader contract: chapters are paths served by zip and indexed', async () => {
  const book = parseTextBook(utf8('开头的引子。\n\n第一章 夜航\n甲板很湿。\n\n第二章 归港\n天亮了。'), '夜航.txt', labels);
  assert.deepEqual(book.chapters, ['chapter-0.html', 'chapter-1.html', 'chapter-2.html']);
  for (let i = 0; i < book.chapters.length; i += 1) {
    const path = book.chapters[i];
    const bytes = await book.zip.entry(path);
    assert.ok(bytes instanceof Uint8Array, `zip.entry(${path}) missing`);
    assert.equal(book.chapterIndex.get(path), i, `chapterIndex.get(${path})`);
    assert.equal(await book.zip.text(path), new TextDecoder().decode(bytes));
  }
  assert.equal(book.chapterIndex.get('chapter-0.html'), 0);
  assert.equal(book.toc[1].chapter, 1);
  assert.equal(book.toc[1].label, '第一章 夜航');
});

test('name always becomes the title; chapterFallback callable or string', () => {
  // Content that starts with a heading has no untitled part: the fallback is
  // simply unused, and the title always comes from the file name.
  const a = parseTextBook(utf8('第一章 A\nx'), '我的书.txt', labels);
  assert.equal(a.title, '我的书');
  assert.equal(a.titles[0], '第一章 A');
  // Untitled leading content: callable (i => localized 'Chapter N').
  const b = parseTextBook(utf8('开头没有标题。\n第一章 A\nx'), 'another.txt', labels);
  assert.equal(b.title, 'another');
  assert.equal(b.titles[0], '第 1 节');
  assert.equal(b.titles[1], '第一章 A');
  // Untitled leading content: plain string fallback.
  const c = parseTextBook(utf8('开头没有标题。\n第一章 A\nx'), 'third.txt', '开头');
  assert.equal(c.titles[0], '开头');
  // No fallback at all: the book title names the leading chunk.
  const d = parseTextBook(utf8('开头没有标题。\n第一章 A\nx'), 'fourth.txt');
  assert.equal(d.titles[0], 'fourth');
});

test('utf8: chapter split, headings, toc and chapterIndex', () => {
  const book = parseTextBook(utf8('风起了。\n\n第一章 夜航\n甲板很湿。\n\n第二章 归港\n天亮了。'), '夜航.txt', labels);
  assert.deepEqual(book.titles, ['第 1 节', '第一章 夜航', '第二章 归港']);
  assert.ok((await0 => await0)(book.chapters.length) === 3);
});

test('utf8: chapter split, headings, toc and chapterIndex', () => {
  const book = parseTextBook(utf8('风起了。\n\n第一章 夜航\n甲板很湿。\n\n第二章 归港\n天亮了。'), '夜航.txt', labels);
  assert.deepEqual(book.titles, ['第 1 节', '第一章 夜航', '第二章 归港']);
  assert.equal(book.chapters.length, 3);
});

test('zip entry/text: unknown paths return null/empty', async () => {
  const book = parseTextBook(utf8('第一章 夜航\n内容一'), '书.txt', labels);
  assert.equal(await book.zip.entry('missing.html'), null);
  assert.equal(await book.zip.text('missing.html'), '');
  const html = await book.zip.text('chapter-0.html');
  assert.ok(html.startsWith('<h2>第一章 夜航</h2>'));
});

test('XSS content is escaped', async () => {
  const book = parseTextBook(utf8('<script>alert(1)</script>\n<img src=x onerror=alert(2)>'), 'x.txt', labels);
  const html = await book.zip.text(book.chapters[0]);
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('<img'));
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(html.includes('&lt;img src=x onerror=alert(2)&gt;'));
});

test('utf16 LE/BE BOM and utf8 BOM decode; title from name', () => {
  const body = '第一章 夜航\n夜晚。';
  assert.equal(parseTextBook(utf16(body), 'le.txt', labels).titles[0], '第一章 夜航');
  assert.equal(parseTextBook(utf16(body, true), 'be.txt', labels).titles[0], '第一章 夜航');
  const withBom = Uint8Array.from([0xef, 0xbb, 0xbf, ...utf8(body)]);
  const book = parseTextBook(withBom, 'bom 书.txt', labels);
  assert.equal(book.titles[0], '第一章 夜航');
  assert.equal(book.title, 'bom 书');
});

test('gb18030 fallback decodes without BOM', () => {
  const book = parseTextBook(gbk('第一章 夜航\n晚上。'), 'gbk.txt', labels);
  assert.equal(book.titles[0], '第一章 夜航');
});

test('english headings: accept conservative, reject prose', () => {
  const book = parseTextBook(utf8('Chapter 1 The Storm\nSea.\n\nChapter 2 Calm\nPort.'), 'en.txt', labels);
  assert.deepEqual(book.titles, ['Chapter 1 The Storm', 'Chapter 2 Calm']);
  const prose = parseTextBook(utf8('He said Chapter 1 is great and Part II follows\nbody'), 'p.txt', labels);
  assert.equal(prose.titles.length, 1);
  const bare = parseTextBook(utf8('Prologue\nonce\nEpilogue\nend'), 'b.txt', labels);
  assert.deepEqual(bare.titles, ['Prologue', 'Epilogue']);
});

test('序章/楔子/尾声 are recognized', () => {
  const book = parseTextBook(utf8('序章\n...\n尾声\n完了'), 's.txt', labels);
  assert.deepEqual(book.titles, ['序章', '尾声']);
});

test('chunk bounds hold even when a huge line follows a half-full buffer', async () => {
  // ~19k of normal lines, then a single 39k-char line: must never produce a
  // chapter above the 40k html bound, and the giant line itself gets split.
  const headBig = Array.from({ length: 1600 }, (_, i) => `第${i}行，一些内容。`).join('\n'); // ~19.2k
  const giant = '很长的句子重复出现。'.repeat(3900); // 39k single line
  const book = parseTextBook(utf8(`${headBig}\n${giant}\n第二章 结束\n好`), 'l.txt', labels);
  assert.equal(book.titles.at(-1), '第二章 结束');
  for (let i = 0; i < book.chapters.length; i += 1) {
    const html = await book.zip.text(book.chapters[i]);
    assert.ok(html.length <= 40000, `chapter ${i} too big: ${html.length}`);
  }
  // Continuation chunks are labelled so titles stay unique.
  const seen = new Set();
  for (const t of book.titles) {
    assert.ok(!seen.has(t), `duplicate title ${t}`);
    seen.add(t);
  }
  // Hostile escape-heavy input (every char grows 6x in html) stays bounded too.
  const hostile = parseTextBook(utf8('<>&"\''.repeat(7000)), 'x.txt', labels);
  for (const path of hostile.chapters) {
    const html = await hostile.zip.text(path);
    assert.ok(html.length <= 40000, `escape-heavy chunk too big: ${html.length}`);
  }
  const single = parseTextBook(utf8('a'.repeat(200000)), 's2.txt', labels);
  for (const path of single.chapters) {
    const html = await single.zip.text(path);
    assert.ok(html.length <= 40010, `single-line chunk too big: ${html.length}`);
  }
  assert.ok(single.titles.some((t) => t.includes('续')));
});

test('paragraphs: physical lines become <br>, blank line closes <p>', async () => {
  const zh = parseTextBook(utf8('第一章\n第一段第一行\n第一段第二行\n\n第二段单独'), 'p2.txt', labels);
  const html = await zh.zip.text(zh.chapters[0]);
  assert.ok(html.includes('<h2>第一章</h2>'));
  assert.ok(html.includes('<p>第一段第一行<br>第一段第二行</p>'));
  assert.ok(html.includes('<p>第二段单独</p>'));
  const en = parseTextBook(utf8('Chapter 1\nsoft wrapped\nlines here\n\nnew para'), 'e.txt', labels);
  const enHtml = await en.zip.text(en.chapters[0]);
  assert.ok(enHtml.includes('<p>soft wrapped<br>lines here</p>'));
  assert.ok(enHtml.includes('<p>new para</p>'));
});

test('errors: empty, whitespace-only, binary, wrong type', () => {
  assert.throws(() => parseTextBook(new Uint8Array(), 'a.txt'), /为空|empty/i);
  assert.throws(() => parseTextBook(utf8('   \n \n\t'), 'a.txt'), /没有有效内容|no meaningful/i);
  const binary = Uint8Array.from({ length: 4096 }, (_, i) => (i * 7 + 13) % 251);
  assert.throws(() => parseTextBook(binary, 'a.txt'), /二进制|binary|unrecognized/i);
  // Binary ASCII padded with NUL bytes must be rejected, not laundered by NUL
  // stripping.
  const nulPadded = Uint8Array.from({ length: 2048 }, (_, i) => (i % 2 ? 0x00 : 0x41 + (i % 26)));
  assert.throws(() => parseTextBook(nulPadded, 'a.txt'), /二进制|binary|没有有效内容|no meaningful/i);
  assert.throws(() => parseTextBook('string', 'a.txt'), /bytes|数据/);
});

test('name fallback strips extension; CRLF normalized', async () => {
  const book = parseTextBook(utf8('第一章 T\r\nline one\r\n\r\nline two'), 'my book.txt', labels);
  assert.equal(book.title, 'my book');
  const html = await book.zip.text(book.chapters[0]);
  assert.ok(html.includes('<p>line one</p>'));
  assert.ok(html.includes('<p>line two</p>'));
});
