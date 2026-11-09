import { MOBI, isMOBI } from '../vendor/mobi.js';

/** Reject encrypted/malformed Palm databases before decompressing book content. */
export function validateMobi(data) {
  const bytes = new Uint8Array(data);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const fail = () => { throw new Error('MOBI/AZW3 文件损坏或格式不受支持 / Invalid MOBI/AZW3 file'); };
  if (bytes.length < 86 || new TextDecoder().decode(bytes.subarray(60, 68)) !== 'BOOKMOBI') fail();
  const count = view.getUint16(76);
  if (!count || 78 + count * 8 > bytes.length) fail();
  let previous = 78 + count * 8;
  for (let i = 0; i < count; i++) {
    const start = view.getUint32(78 + i * 8);
    const end = i + 1 < count ? view.getUint32(86 + i * 8) : bytes.length;
    if (start < previous || end < start || end > bytes.length) fail();
    previous = end;
    const magic = new TextDecoder().decode(bytes.subarray(start + 16, start + 20));
    if (i === 0 && (end - start < 40 || magic !== 'MOBI')) fail();
    // This also checks the KF8 header in combo MOBI/KF8 files.
    if (end - start >= 40 && magic === 'MOBI' && view.getUint16(start + 12) !== 0) {
      throw new Error('不支持带 DRM 加密的 MOBI/AZW3，请导入无 DRM 的文件 / DRM-protected books are not supported');
    }
  }
}

const coverMime = bytes => bytes[0] === 0x89 && bytes[1] === 0x50 ? 'image/png'
  : bytes[0] === 0x47 && bytes[1] === 0x49 ? 'image/gif'
  : bytes[0] === 0x52 && bytes[8] === 0x57 ? 'image/webp' : 'image/jpeg';

/** Adapt Foliate's MOBI6/KF8 sections to the existing EPUB reading contract. */
export async function parseMobiBook(data, name, chapterFallback) {
  validateMobi(data);
  const file = new Blob([data]);
  if (!await isMOBI(file)) throw new Error('Invalid MOBI/AZW3 file');
  const unzlib = async bytes => new Uint8Array(await new Response(
    new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate')),
  ).arrayBuffer());
  const book = await new MOBI({ unzlib }).open(file);
  try {
    const sections = book.sections.map((section, index) => ({ section, index }))
      .filter(({ section }) => typeof section.load === 'function');
    if (!sections.length) throw new Error('没有可阅读的章节 / No readable sections');
    const chapters = sections.map((_, index) => `mobi-${index}.html`);
    const mapped = new Map(sections.map(({ index }, i) => [index, i]));
    const chapterIndex = new Map(chapters.map((path, i) => [path, i]));
    const titles = chapters.map((_, i) => chapterFallback?.(i) || `Chapter ${i + 1}`);
    const toc = [];
    const anchors = new Map();
    const walk = async (rows, depth = 0) => {
      if (depth > 16) return;
      for (const row of rows ?? []) {
        try {
          const resolved = await book.resolveHref(row.href);
          const chapter = mapped.get(resolved?.index);
          if (chapter !== undefined) {
            const fragment = `bk-mobi-toc-${toc.length}`;
            const label = String(row.label || titles[chapter]).trim();
            if (!anchors.has(chapter)) anchors.set(chapter, []);
            anchors.get(chapter).push({ fragment, anchor: resolved.anchor });
            if (!toc.some(item => item.chapter === chapter)) titles[chapter] = label;
            toc.push({ label, chapter, fragment, depth: Math.min(3, depth) });
          }
        } catch { /* Broken TOC entries should not prevent reading the book. */ }
        await walk(row.subitems, depth + 1);
      }
    };
    await walk(book.toc);
    if (!toc.length) chapters.forEach((_, chapter) => toc.push({ label: titles[chapter], chapter, fragment: '', depth: 0 }));
    let cover = null;
    try {
      const blob = await book.getCover();
      if (blob) {
        const bytes = new Uint8Array(await blob.arrayBuffer());
        cover = { bytes, mime: coverMime(bytes) };
      }
    } catch { /* A missing cover is harmless. */ }
    let destroyed = false;
    const cache = new Map();
    const text = async path => {
      if (destroyed) throw new Error('Book is closed');
      const index = chapterIndex.get(path);
      if (index === undefined) return null;
      if (!cache.has(path)) cache.set(path, (async () => {
        // load(), unlike createDocument(), resolves embedded images and SVGs.
        const url = await sections[index].section.load();
        const response = await fetch(url);
        const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
        if (destroyed) throw new Error('Book is closed');
        for (const { fragment, anchor } of anchors.get(index) ?? []) {
          try {
            const target = anchor?.(doc);
            if (target) {
              const marker = doc.createElement('span');
              marker.id = fragment;
              target.before(marker);
            }
          } catch { /* Fall back to the chapter's start. */ }
        }
        for (const link of doc.querySelectorAll('a[href]')) {
          const href = link.getAttribute('href');
          if (!/^(filepos|kindle):/i.test(href)) continue;
          try {
            const resolved = await book.resolveHref(href);
            const target = mapped.get(resolved?.index);
            if (target !== undefined) link.setAttribute('href', chapters[target]);
            else link.removeAttribute('href');
          } catch { link.removeAttribute('href'); }
        }
        return doc.documentElement.outerHTML;
      })().catch(error => { cache.delete(path); throw error; }));
      return cache.get(path);
    };
    return {
      title: book.metadata?.title || name.replace(/\.(mobi|azw3)$/i, ''),
      author: Array.isArray(book.metadata?.author) ? book.metadata.author.join('、') : (book.metadata?.author || ''),
      cover, chapters, titles, toc, chapterIndex,
      // Only this adapter may preserve the blob URLs generated by its parser.
      ownsResourceUrl: value => typeof value === 'string' && value.startsWith('blob:'),
      zip: { text, entry: async path => { const html = await text(path); return html === null ? null : new TextEncoder().encode(html); } },
      destroy() { destroyed = true; cache.clear(); book.destroy(); },
    };
  } catch (error) {
    book.destroy();
    throw error;
  }
}
