import test from 'node:test';
import assert from 'node:assert/strict';
import { validateMobi } from '../src/mobi-book.js';
import { mobiFixture } from './mobi-fixtures.js';

test('accepts valid uncompressed and PalmDOC MOBI record tables', () => {
  assert.doesNotThrow(() => validateMobi(mobiFixture()));
  assert.doesNotThrow(() => validateMobi(mobiFixture({ compressed: true })));
});
test('rejects DRM with an actionable error before decoding', () => {
  assert.throws(() => validateMobi(mobiFixture({ encrypted: true })), /DRM/);
});
test('rejects unrelated, truncated and corrupt Palm databases', () => {
  assert.throws(() => validateMobi(new ArrayBuffer(5)), /Invalid/);
  const bad = mobiFixture();
  new DataView(bad).setUint32(78, 0xffffffff);
  assert.throws(() => validateMobi(bad), /Invalid/);
  const reversed = mobiFixture();
  new DataView(reversed).setUint32(86, 1);
  assert.throws(() => validateMobi(reversed), /Invalid/);
});
