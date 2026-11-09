# Vendored sources

Third-party sources embedded into `client.js` at build time by
`tools/build-formats.mjs`. Nothing in this directory is installed from npm;
each file is pinned to an exact upstream commit.

## mobi.js

- **Upstream**: <https://github.com/johnfactotum/foliate-js/blob/main/mobi.js>
- **Pinned commit**: `78914aef4466eb960965702401634c2cb348e9b1`
- **Source URL at that commit**:
  <https://raw.githubusercontent.com/johnfactotum/foliate-js/78914aef4466eb960965702401634c2cb348e9b1/mobi.js>
- **License**: MIT — full text in [`foliate-js.LICENSE`](foliate-js.LICENSE)
  (Copyright (c) 2022 John Factotum)

Parses DRM-free MOBI (MOBI7) and AZW3 (KF8) files in the browser: PalmDOC and
HUFF/CDIC decompression, EXTH metadata, cover extraction, INDX-based tables of
contents, and `recindex` / `kindle:embed:` resource resolution. It is a single
ES module with no imports from the rest of foliate-js.

foliate-js has no npm releases and its API is documented as unstable, so the
copy is pinned to the commit above. To update:

1. Fetch `mobi.js` from a newer commit of foliate-js.
2. Replace `mobi.js` here, update the pinned commit in this README **and** the
   commit reference in `tools/build-formats.mjs` (it is embedded in the
   generated banner of `client.js`).
3. Run `node tools/build-formats.mjs` and `npm test`.

The vendored file is never edited by hand except for the build script's import
stripping, which happens in memory — the file on disk stays byte-identical to
upstream.
