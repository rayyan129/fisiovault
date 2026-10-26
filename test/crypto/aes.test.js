const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');

const aes = require('../../src/crypto/aes');
const { sha256, encryptBuffer, decryptBuffer } = require('./helpers');

test('round-trip: hasil dekripsi identik (SHA-256 sama)', async () => {
  const plaintext = crypto.randomBytes(5 * 1024 * 1024 + 7); // 5 MB, ukuran ganjil
  const key = aes.generateKey();

  const { ciphertext, iv, authTag } = await encryptBuffer(aes, plaintext, key);
  const decrypted = await decryptBuffer(aes, ciphertext, key, iv, authTag);

  assert.strictEqual(sha256(decrypted), sha256(plaintext));
  assert.strictEqual(iv.length, 12);
  assert.strictEqual(authTag.length, 16);
  assert.strictEqual(ciphertext.length, plaintext.length); // GCM tidak menambah padding
});

test('round-trip: file kosong', async () => {
  const key = aes.generateKey();
  const { ciphertext, iv, authTag } = await encryptBuffer(aes, Buffer.alloc(0), key);
  const decrypted = await decryptBuffer(aes, ciphertext, key, iv, authTag);
  assert.strictEqual(decrypted.length, 0);
});

test('IV berbeda setiap enkripsi walau kunci & data sama', async () => {
  const key = aes.generateKey();
  const data = Buffer.from('data pasien yang sama');
  const a = await encryptBuffer(aes, data, key);
  const b = await encryptBuffer(aes, data, key);
  assert.notDeepStrictEqual(a.iv, b.iv);
  assert.notDeepStrictEqual(a.ciphertext, b.ciphertext);
});

test('ciphertext diubah 1 bit -> dekripsi ditolak', async () => {
  const key = aes.generateKey();
  const { ciphertext, iv, authTag } = await encryptBuffer(aes, Buffer.from('hasil rontgen'), key);
  ciphertext[0] ^= 0x01;
  await assert.rejects(decryptBuffer(aes, ciphertext, key, iv, authTag));
});

test('kunci salah -> dekripsi ditolak', async () => {
  const { ciphertext, iv, authTag } = await encryptBuffer(aes, Buffer.from('no BPJS'), aes.generateKey());
  await assert.rejects(decryptBuffer(aes, ciphertext, aes.generateKey(), iv, authTag));
});
