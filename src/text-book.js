/**
 * TXT 解析 — turns a plain-text novel into an EPUB-like book object, so the
 * reader can open a .txt with the same code path it uses for EPUBs.
 *
 * Only `parseTextBook` is exported (a single named function declaration): the
 * client build script inlines this file by stripping `export ` prefixes, so
 * export lists, default exports and imports would all break that. Every
 * top-level helper is `txt`-prefixed because this file is embedded next to
 * vendor code (pdf.js, mobi.js) that already owns names like `decoder`.
 * No DOM dependency — TextDecoder/TextEncoder/Map only.
 *
 * Reader contract (must match the EPUB shape):
 *   chapters       — array of zip paths ('chapter-0.html', …), NOT html
 *   zip.entry/text — serve those paths
 *   chapterIndex   — Map<path, index>
 *   toc            — [{ label, chapter, fragment: '', depth: 0 }]
 */

const TXT_CHUNK_TARGET = 20000;
// Hard ceiling for one chunk's rendered html. The splitter budgets every source
// character at TXT_ESCAPE_WORST (& < > " ' grow up to 6x), so even a hostile
// quote-only file yields bounded output; normal text stays well under it.
const TXT_CHUNK_MAX = 40000;
const TXT_ESCAPE_WORST = 6;

const txtDecoder = (encoding, fatal = true) => new TextDecoder(encoding, { fatal });

function txtBytesOf(data) {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  throw new TypeError('TXT 数据必须是 Uint8Array、ArrayBuffer 或其视图 / TXT data must be bytes');
}

/** Decode with BOM detection. Returns { text, bom16 } — bom16 marks a real
 *  UTF-16 file, whose decode may legitimately contain stray NULs. */
function txtDecode(data) {
  const bytes = txtBytesOf(data);
  if (!bytes.length) throw new Error('TXT 文件为空 / TXT file is empty');
  let text = '';
  let bom16 = false;
  try {
    if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) { bom16 = true; text = txtDecoder('utf-16le').decode(bytes); }
    else if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) { bom16 = true; text = txtDecoder('utf-16be').decode(bytes); }
    else if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) text = txtDecoder('utf-8').decode(bytes);
    else {
      try { text = txtDecoder('utf-8').decode(bytes); }
      catch { text = txtDecoder('gb18030').decode(bytes); }
    }
  } catch {
    throw new Error('TXT 疑似二进制或无法识别编码 / TXT appears binary or uses an unrecognized encoding');
  }
  if (!text.trim()) throw new Error('TXT 文件没有有效内容 / TXT file has no meaningful content');
  // Control scan runs BEFORE NUL stripping and counts NULs: binary ASCII padded
  // with NUL bytes must be rejected, not laundered. Only a genuine UTF-16 BOM
  // file is excused (its decode can leave stray NULs from truncated pairs).
  let controls = 0;
  const limit = Math.max(3, text.length * 0.01);
  for (const ch of text) {
    const n = ch.codePointAt(0);
    if (n === 0 || n < 0x09 || (n > 0x0d && n < 0x20)) {
      controls += 1;
      if (controls > limit && !bom16) {
        throw new Error('TXT 文件疑似二进制文件 / TXT appears to be binary data');
      }
    }
  }
  text = text.replace(/^\uFEFF/, '').replace(/\u0000/g, '');
  if (!text.trim()) throw new Error('TXT 文件没有有效内容 / TXT file has no meaningful content');
  return { text: text.replace(/\r\n?/g, '\n'), bom16 };
}

function txtEscapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/**
 * Conservative heading test. False positives split a book in wrong places, so a
 * line only counts when the whole line is the heading:
 *   第X章/节/卷/回/部/篇/集 + optional short suffix, 序章/楔子/引子/尾声/后记/番外/跋
 *   Chapter/Part/Volume/Book + number or Roman numeral + title
 *   Prologue/Epilogue/Afterword/Foreword/Preface/Appendix alone
 */
function txtHeadingOf(line) {
  const s = line.trim().replace(/[\s　]+/g, ' ');
  if (!s || s.length > 100) return null;
  const stem = /^(?:第\s*[一二三四五六七八九十百千万零〇两\d]+\s*[章节卷回部篇集]|序章|楔子|序言|引子|尾声|后记|番外|跋)/u;
  const chinese = (stem.test(s) && s.replace(stem, '').length <= 50)
    || /^(?:序章|楔子|序言|引子|尾声|后记|番外|跋)(?:\s*[:：.．、]\s*\S.*)?$/u.test(s);
  const numbered = /^(?:chapter|part|volume|book)\s+(?:[1-9][0-9]*|[IVXLC]+|\d+[.\-]\d+)(?:\s*[:.\-–—]\s*\S.*|\s+\S.*)?$/iu.test(s);
  const bare = /^(?:prologue|epilogue|afterword|foreword|preface|appendix)$/iu.test(s);
  return chinese || numbered || bare ? s : null;
}

/** Kept for the browser-side paragraph heuristic if the reader ever wants the
 *  joined look; the default rendering preserves physical line breaks. */
function txtJoinLines(lines) {
  let out = '';
  for (const line of lines) {
    const piece = line.trim();
    if (!out) out = piece;
    else out += (/[A-Za-z0-9]$/.test(out) && /^[A-Za-z0-9]/.test(piece)) ? ` ${piece}` : piece;
  }
  return out;
}

function txtParagraphHtml(lines) {
  // One physical line = one rendered line: TXT novels are usually one paragraph
  // per line, and silently joining adjacent lines would merge them into a wall
  // of text. A blank line still closes the <p>, so both styles survive.
  const out = [];
  let paragraph = [];
  const flush = () => {
    if (paragraph.length) out.push(`<p>${paragraph.map((l) => txtEscapeHtml(l.trim())).join('<br>')}</p>`);
    paragraph = [];
  };
  for (const line of lines) {
    if (!line.trim()) flush();
    else paragraph.push(line);
  }
  flush();
  return out.join('\n');
}

function txtMakeChapter(lines, heading) {
  const body = heading && lines[0] && txtHeadingOf(lines[0]) === heading ? lines.slice(1) : lines;
  return `${heading ? `<h2>${txtEscapeHtml(heading)}</h2>\n` : ''}${txtParagraphHtml(body)}` || '<p></p>';
}

/**
 * Split into chapters. `firstTitle` titles the content before the first
 * heading. Bounds: chunks aim for TXT_CHUNK_TARGET (source chars) and their
 * rendered html never exceeds TXT_CHUNK_MAX — the budget below accounts for
 * worst-case escape growth, a long line is flushed-then-split, never appended
 * to a half-full buffer (19k buffer + 39k line must not become a 58k chapter).
 * Continuation chunks carry a （续N） suffix so every title stays unique.
 */
function txtSplitChapters(text, firstTitle) {
  const chunks = [];
  let current = [];
  let currentLength = 0; // source chars (a good proxy; html stays under TXT_CHUNK_MAX)
  let title = firstTitle;
  let extra = 0; // chunks already emitted under the current title
  const push = () => {
    if (current.some((x) => x.trim())) {
      chunks.push({ title: extra ? `${title}（续${extra}）` : title, lines: current });
      extra += 1;
    }
    current = [];
    currentLength = 0;
  };
  const add = (line) => {
    current.push(line);
    currentLength += line.length * TXT_ESCAPE_WORST + 1;
  };
  for (const original of text.split('\n')) {
    const heading = txtHeadingOf(original);
    if (heading) {
      if (current.some((x) => x.trim())) push();
      title = heading;
      extra = 0;
    }
    // Worst-case escape growth means a physical line longer than this could
    // alone exceed the html bound — cut it first, then flush pieces.
    const pieceMax = Math.floor(TXT_CHUNK_MAX / TXT_ESCAPE_WORST) - 2;
    if (original.length > pieceMax) {
      push();
      let rest = original;
      while (rest.length > pieceMax) {
        add(rest.slice(0, pieceMax));
        push();
        rest = rest.slice(pieceMax);
      }
      if (rest) add(rest);
    } else {
      if (currentLength > 0 && currentLength + original.length * TXT_ESCAPE_WORST >= TXT_CHUNK_MAX) push();
      add(original);
    }
    if (currentLength >= TXT_CHUNK_TARGET * TXT_ESCAPE_WORST) push();
  }
  push();
  return chunks.length ? chunks : [{ title: firstTitle, lines: [''] }];
}

/**
 * Parse raw TXT bytes into an EPUB-like book.
 * @param {Uint8Array|ArrayBuffer} data raw file bytes (UTF-8 / UTF-16 BOM /
 *   GB18030 are auto-detected)
 * @param {string} [name] file name — always the book title (extension stripped)
 * @param {function|string} [chapterFallback] `i => localized 'Chapter N'` for
 *   content before the first heading (a plain string is also accepted)
 * @returns {{zip:{entry:(p:string)=>Promise<Uint8Array|null>,text:(p:string)=>Promise<string>},title:string,author:'',cover:null,chapters:string[],titles:string[],toc:{label:string,chapter:number,fragment:'',depth:0}[],chapterIndex:Map<string,number>}}
 */
export function parseTextBook(data, name = 'TXT', chapterFallback = '') {
  const { text } = txtDecode(data);
  const title = String(name || 'TXT').replace(/\.[^.]+$/, '') || 'TXT';
  const fallbackTitle = String(
    typeof chapterFallback === 'function' ? chapterFallback(0) : (chapterFallback || title),
  ).trim() || title;
  const chunks = txtSplitChapters(text, fallbackTitle);
  const titles = chunks.map((c) => c.title);
  const chapters = titles.map((_, i) => `chapter-${i}.html`);
  const toc = titles.map((label, chapter) => ({ label, chapter, fragment: '', depth: 0 }));
  const chapterIndex = new Map(chapters.map((path, i) => [path, i]));
  const encoder = new TextEncoder();
  const entries = new Map(chunks.map((c, i) => [chapters[i], encoder.encode(txtMakeChapter(c.lines, c.title))]));
  const zip = {
    async entry(path) { return entries.get(path) ?? null; },
    async text(path) { const value = entries.get(path); return value ? txtDecoder('utf-8', false).decode(value) : ''; },
  };
  return { zip, title, author: '', cover: null, chapters, titles, toc, chapterIndex };
}
