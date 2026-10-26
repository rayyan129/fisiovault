const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');

const rc4 = require('../../src/crypto/rc4');
const { sha256, xor, encryptBuffer, decryptBuffer } = require('./helpers');

test('round-trip: hasil dekripsi identik (SHA-256 sama)', async () => {
  const plaintext = crypto.randomBytes(5 * 1024 * 1024 + 7);
  const key = rc4.generateKey();

  const { ciphertext } = await encryptBuffer(rc4, plaintext, key);
  const decrypted = await decryptBuffer(rc4, ciphertext, key);

  assert.strictEqual(sha256(decrypted), sha256(plaintext));
  assert.strictEqual(ciphertext.length, plaintext.length); // stream cipher: tanpa padding
});

test('round-trip: file kosong', async () => {
  const key = rc4.generateKey();
  const { ciphertext } = await encryptBuffer(rc4, Buffer.alloc(0), key);
  assert.strictEqual(ciphertext.length, 0);
  assert.strictEqual((await decryptBuffer(rc4, ciphertext, key)).length, 0);
});

test('kunci baru per file: data sama -> ciphertext berbeda', async () => {
  const data = Buffer.from('data pasien yang sama');
  const a = await encryptBuffer(rc4, data, rc4.generateKey());
  const b = await encryptBuffer(rc4, data, rc4.generateKey());
  assert.notDeepStrictEqual(a.ciphertext, b.ciphertext);
});

test('kunci salah -> tidak error, tapi hasilnya sampah', async () => {
  const plaintext = Buffer.from('no BPJS 0001234567890');
  const { ciphertext } = await encryptBuffer(rc4, plaintext, rc4.generateKey());
  const decrypted = await decryptBuffer(rc4, ciphertext, rc4.generateKey()); // tidak error
  assert.notDeepStrictEqual(decrypted, plaintext);
});

test('malleable: membalik 1 bit ciphertext membalik bit yang SAMA di plaintext', async () => {
  // Penyerang bisa mengubah isi secara terarah tanpa tahu kuncinya.
  const key = rc4.generateKey();
  const plaintext = Buffer.from('Sesi terapi: 2x/minggu');
  const { ciphertext } = await encryptBuffer(rc4, plaintext, key);

  const pos = plaintext.indexOf('2');
  ciphertext[pos] ^= '2'.charCodeAt(0) ^ '9'.charCodeAt(0);

  const decrypted = await decryptBuffer(rc4, ciphertext, key);
  assert.strictEqual(decrypted.toString(), 'Sesi terapi: 9x/minggu');
});

test('BAHAYA kunci dipakai ulang: C1 XOR C2 = P1 XOR P2', async () => {
  // Alasan aturan "kunci acak per file, jangan pernah dipakai ulang".
  const key = rc4.generateKey();
  const p1 = Buffer.from('Nama: Budi Santoso, BPJS 0001234567890');
  const p2 = Buffer.from('Nama: Siti Aminah,  BPJS 0009876543210');
  const c1 = (await encryptBuffer(rc4, p1, key)).ciphertext;
  const c2 = (await encryptBuffer(rc4, p2, key)).ciphertext;

  // Keystream saling meniadakan; tahu p1 berarti langsung tahu p2.
  assert.deepStrictEqual(xor(c1, c2), xor(p1, p2));
  assert.deepStrictEqual(xor(xor(c1, c2), p1), p2);
});
