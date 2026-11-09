// Offline browser harness when Tabbit's CDP connection cannot create a page.
// Prepares HTML only; run it with Chrome --headless --dump-dom --virtual-time-budget=60000.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mobiFixture } from './mobi-fixtures.js';
const root = new URL('../', import.meta.url);
const source = await readFile(new URL('client.js', root), 'utf8');
const suite = await readFile(new URL('tests/browser-formats-check.tabbit.js', root), 'utf8');
const a = source.indexOf('    // BEGIN GENERATED BOOK FORMATS');
const b = source.indexOf('    // END GENERATED BOOK FORMATS', a);
const h = source.indexOf('    async function chapterHtml(');
// Reproduce the real client lexical scope, not an isolated parser-only scope.
// A stylesheet binding named CSS used to shadow the browser CSS.escape API.
const styleStart = source.search(/    const (?:CSS|BOOK_STYLES) = `/);
const styleEnd = source.indexOf('    const STYLE_NODE =', styleStart);
if (styleStart < 0 || styleEnd < styleStart) throw new Error('Stylesheet scope marker missing');
const engine = source.slice(a, b) + '\nconst CODE_STACK = "monospace";\n' + source.slice(styleStart, styleEnd);
const renderer = source.slice(source.indexOf('    function dirname('), source.indexOf('    function parseXml(')) + '\n'
  + source.slice(h, source.indexOf('    /* ------------------------------------------------------------------ *', h));
const fixtures = [
  { name: 'fixture.mobi', bytes: [...new Uint8Array(mobiFixture({ withImage: true }))] },
  { name: 'palmdoc.mobi', bytes: [...new Uint8Array(mobiFixture({ compressed: true }))] },
];
const dir = join(tmpdir(), 'dsh-format-check');
await mkdir(dir, { recursive: true });
for (const name of ['alice.mobi', 'alice.azw3']) {
  try { fixtures.push({ name, bytes: [...await readFile(join(dir, name))] }); } catch {}
}
const testStart = suite.indexOf('const result = await page.evaluate(async ({engine,renderer,fixtures}) => {');
const testEnd = suite.indexOf('\n}, {engine,renderer,fixtures});', testStart);
if (a < 0 || b < a || testStart < 0 || testEnd < testStart) throw new Error('Harness markers missing');
const body = suite.slice(suite.indexOf('\n', testStart), testEnd);
const js = `const run = async ({engine,renderer,fixtures}) => {${body}\n};\nrun(${JSON.stringify({ engine, renderer, fixtures })}).then(result => {document.body.textContent='PASS '+JSON.stringify(result);}).catch(error=>{document.body.textContent='FAIL '+error.stack;});`;
const output = join(dir, 'formats.html');
await writeFile(output, '<!doctype html><meta charset="utf-8"><body>RUNNING<script>' + js.replace(/<\/script/gi, '<\\/script') + '</script>');
console.log(output);
