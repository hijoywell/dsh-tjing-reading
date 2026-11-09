/** Small generated, public-domain fixtures; no commercial book data. */
export function mobiFixture({ encrypted = false, compressed = false, withImage = false, html } = {}) {
  const source = html ?? `<html><head><title>Fixture</title></head><body><h1>Chapter One</h1><p>Hello MOBI 世界.</p>${withImage ? '<img recindex="1">' : ''}<mbp:pagebreak/><h1>Chapter Two</h1><p>Second chapter.</p></body></html>`;
  const encoder = new TextEncoder();
  const plain = encoder.encode(source);
  // PalmDOC literal blocks encode arbitrary UTF-8 without back-references.
  const body = compressed ? Uint8Array.from(Array.from({ length: Math.ceil(plain.length / 8) }, (_, i) => {
    const chunk = plain.subarray(i * 8, i * 8 + 8);
    return [chunk.length, ...chunk];
  }).flat()) : plain;
  const header = new Uint8Array(300);
  const hv = new DataView(header.buffer);
  hv.setUint16(0, compressed ? 2 : 1);
  hv.setUint32(4, plain.length);
  hv.setUint16(8, 1);
  hv.setUint16(10, 4096);
  hv.setUint16(12, encrypted ? 2 : 0);
  header.set(encoder.encode('MOBI'), 16);
  hv.setUint32(20, 232);
  hv.setUint32(24, 2);
  hv.setUint32(28, 65001);
  hv.setUint32(32, 123);
  hv.setUint32(36, 6);
  hv.setUint32(84, 264);
  hv.setUint32(88, 12);
  header.set(encoder.encode('Fixture Book'), 264);
  hv.setUint32(108, 2);
  hv.setUint32(244, 0xffffffff);
  const image = withImage ? new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64')) : new Uint8Array();
  const count = withImage ? 3 : 2;
  const offset = 78 + count * 8 + 2;
  const file = new Uint8Array(offset + header.length + body.length + image.length);
  const fv = new DataView(file.buffer);
  file.set(encoder.encode('Fixture Book'), 0);
  file.set(encoder.encode('BOOKMOBI'), 60);
  fv.setUint16(76, count);
  fv.setUint32(78, offset);
  fv.setUint32(86, offset + header.length);
  if (withImage) fv.setUint32(94, offset + header.length + body.length);
  file.set(header, offset);
  file.set(body, offset + header.length);
  file.set(image, offset + header.length + body.length);
  return file.buffer;
}
