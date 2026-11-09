import { readFile, writeFile } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
const read = path => readFile(new URL(path, root), 'utf8');
const stripModule = source => source.replace(/^import .*;\r?\n/gm, '').replace(/^export (?=(?:async )?(?:function|class|const|let)\b)/gm, '');
const license = await read('vendor/foliate-js.LICENSE');
const mobi = stripModule(await read('vendor/mobi.js'));
const adapter = stripModule(await read('src/mobi-book.js'));
const text = stripModule(await read('src/text-book.js'));
const block = `    // BEGIN GENERATED BOOK FORMATS — run node tools/build-formats.mjs\n    /* foliate-js/mobi.js @ 78914aef4466eb960965702401634c2cb348e9b1\n${license.trim()}\n    */\n    const BOOK_FORMATS = (() => {\n      const mobiEngine = (() => {\n${mobi}\nreturn { MOBI, isMOBI };\n})();\n      const mobiAdapter = (() => {\nconst { MOBI, isMOBI } = mobiEngine;\n${adapter}\nreturn { parseMobiBook };\n})();\n      const textAdapter = (() => {\n${text}\nreturn { parseTextBook };\n})();\n      return { ...textAdapter, ...mobiAdapter };\n    })();\n    // END GENERATED BOOK FORMATS`;
const path = new URL('client.js', root);
let client = await readFile(path, 'utf8');
const pattern = /    \/\/ BEGIN GENERATED BOOK FORMATS[^]*?    \/\/ END GENERATED BOOK FORMATS/;
if (pattern.test(client)) client = client.replace(pattern, () => block);
else {
  const marker = '    /* ------------------------------------------------------------------ *\n     * EPUB parsing';
  // Accept CRLF checkouts as well.
  const at = client.indexOf(marker) >= 0 ? client.indexOf(marker) : client.indexOf(marker.replaceAll('\n', '\r\n'));
  if (at < 0) throw new Error('EPUB parser insertion marker not found');
  client = client.slice(0, at) + block + '\n\n' + client.slice(at);
}
await writeFile(path, client);
console.log('Embedded offline MOBI/AZW3/TXT parsers in client.js');
