# 竹居 · dsh-tjing-reading

An EPUB / PDF / Kindle / plain-text reader that lives in the DSH sidebar — WeChat Read style typography, table of contents, bookmarks, highlights and reading-progress memory, select-to-translate, plus an AI assistant that answers only from passages retrieved from the book you have open.

**English** · [简体中文](README.zh.md)

> Verified on DSH 0.2.1 – 0.2.2 (desktop and `web` profile) · Plain JavaScript, no install-time build · MIT

---

## Supported formats

| Format | Notes |
|---|---|
| EPUB 2 / 3 | Spine, NCX/nav TOC, images, themes and adjustable typography. |
| PDF | 22 zoom steps, continuous scrolling, first-page cover thumbnails. |
| MOBI / AZW3 (KF8) | DRM-free Kindle files only. Combo files open the KF8 half automatically. |
| TXT | UTF-8, UTF-16 (LE/BE with BOM) and GB18030 are detected automatically; chapters are detected from heading patterns (`Chapter 1`, `第一章`, etc.) and can be jumped to from the contents panel. |

What is **not** supported: DRM-protected MOBI/AZW3 files (no DRM removal), KFX, and `.azw` files. Import Kindle books with their correct `.mobi` or `.azw3` extension; their Palm database headers are validated before parsing.

## Features

- **Import** EPUB, PDF, MOBI/AZW3 or TXT through the file picker, or drag & drop into the bookshelf.
- **Reader** with WeChat Read style typography: font size, line height, page margins, and multiple themes (default, green, parchment, dark). The PDF paper colour follows the theme too; the zoom percentage stays fixed relative to the width captured when the book was opened, so folding the sidebar never rescales the page.
- **Navigation**: table of contents, chapter jumps, bookmarks and highlights.
- **Progress memory**: reopening a book returns you to where you left off.
- **Select to translate**: highlight any passage and translate it to Chinese in one tap; the model is the one configured in your host.
- **Ask the book**: an AI assistant grounded in passages retrieved from the open book — streamed answers with the cited passages attached.
- **Bilingual UI**: Chinese and English.

## Install

The desktop app owns its `desktop` profile, so plugins are installed from the UI rather than the CLI.

**Desktop** — Settings → Plugins → Add plugin, then enter:

```
github:hijoywell/dsh-tjing-reading
```

**Any other profile** (web, tui, custom):

```bash
dsh plugin --profile web add github:hijoywell/dsh-tjing-reading
```

**From a source checkout** (development):

```bash
git clone https://github.com/hijoywell/dsh-tjing-reading
dsh plugin --profile web add "link:$PWD/dsh-tjing-reading"
```

Restart DSH after installing; the 竹居 icon appears in the sidebar.

> Not published to npm yet — `dsh plugin add dsh-tjing-reading` will fail. Use the Git address above.

## Usage

1. Click 竹居 in the sidebar and import an EPUB, PDF, MOBI/AZW3 or TXT.
2. Open a book to read; the top bar switches theme, font size and line height, and the contents panel handles chapter jumps and bookmarks.
3. Select text to highlight or translate. The 问书 (ask the book) panel sends your question together with the relevant passages from the current book.

## Where your data lives

Book files, bookmarks, highlights and reading progress are stored in the browser's IndexedDB. Nothing is uploaded to a server.

IndexedDB is scoped per origin, so switching browser or port (another profile, a different `dsh web` port) starts with an empty bookshelf. That is the browser's security model, not data loss.

When you ask the book a question, only the handful of passages retrieved for that question — never the whole book — is sent to the model configured in your host. The host does not store book content. Without a configured model, the assistant tells you to set one up instead of failing silently.

## Compatibility

- Verified on DSH `0.2.1-rc.5` and `0.2.2-rc.1`, desktop and `web` profile.
- No `engines.dsh` constraint is declared on purpose: a narrow range makes the host refuse to load the plugin after a DSH upgrade. If your host is older than 0.2.1 the sidebar entry will not appear — upgrade DSH first.
- Standard Web APIs only: `DecompressionStream` for EPUB, Canvas for PDF, IndexedDB for storage. pdf.js (Apache-2.0) is inlined into `client.js`, so there are no runtime dependencies.

## Development

```
index.js            Host half — /api/bookshelf/ai/chat, /api/bookshelf/ai/translate and /api/bookshelf/ai/models
client.js           Client half — sidebar entry, bookshelf, reader, EPUB/PDF/MOBI/TXT parsing
src/                Format sources that are embedded into client.js (mobi-book.js, text-book.js)
vendor/             Vendored third-party sources (see vendor/README.md)
tools/build-formats.mjs  Embeds vendor/mobi.js + src/*.js into client.js (run after editing them)
tests/              Node test-runner suites — npm test
cordis.patch.yml    Cordis patch that mounts the plugin
locale/             zh.json / en.json
icon.svg            Sidebar icon
```

- No bundler and no installed runtime dependencies: edit the files and they are the artifact. The one generated part is the embedded book-format block in `client.js` — after changing `src/` or `vendor/`, run `node tools/build-formats.mjs` to regenerate it.
- `npm test` runs the suites in `tests/` with Node's built-in test runner (`node --test tests/*.test.js`); it needs no installed dev dependencies.
- Install with `link:` into a profile while developing, then restart DSH to pick changes up (host code is loaded into the process; for `client.js`-only changes try a page refresh first).
- The `id` in `window.__ModuleLoader__.load({ id: 'dsh-tjing-reading', … })` must match the package name, otherwise the host cannot resolve the client half.

## License

MIT
