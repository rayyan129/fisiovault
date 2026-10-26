const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const { Readable, PassThrough } = require('stream');

const aes = require('../../src/crypto/aes');

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

// Jalankan encrypt/decrypt di memori (cukup untuk tes; aplikasi nanti pakai file stream).
async function runEncrypt(plaintext, key) {
  const chunks = [];
  const out = new PassThrough();
  out.on('data', (c) => chunks.push(c));
  const meta = await aes.encrypt(Readable.from([plaintext]), out, key);
  return { ciphertext: Buffer.concat(chunks), ...meta };
}

async function runDecrypt(ciphertext, key, iv, authTag) {
  const chunks = [];
  const out = new PassThrough();
  out.on('data', (c) => chunks.push(c));
  await aes.decrypt(Readable.from([ciphertext]), out, key, iv, authTag);
  return Buffer.concat(chunks);
}

test('round-trip: hasil dekripsi identik (SHA-256 sama)', async () => {
  const plaintext = crypto.randomBytes(5 * 1024 * 1024 + 7); // 5 MB, ukuran ganjil
  const key = aes.generateKey();

  const { ciphertext, iv, authTag } = await runEncrypt(plaintext, key);
  const decrypted = await runDecrypt(ciphertext, key, iv, authTag);

  assert.strictEqual(sha256(decrypted), sha256(plaintext));
  assert.strictEqual(iv.length, 12);
  assert.strictEqual(authTag.length, 16);
  assert.strictEqual(ciphertext.length, plaintext.length); // GCM tidak menambah padding
});

test('round-trip: file kosong', async () => {
  const key = aes.generateKey();
  const { ciphertext, iv, authTag } = await runEncrypt(Buffer.alloc(0), key);
  const decrypted = await runDecrypt(ciphertext, key, iv, authTag);
  assert.strictEqual(decrypted.length, 0);
});

test('IV berbeda setiap enkripsi walau kunci & data sama', async () => {
  const key = aes.generateKey();
  const data = Buffer.from('data pasien yang sama');
  const a = await runEncrypt(data, key);
  const b = await runEncrypt(data, key);
  assert.notDeepStrictEqual(a.iv, b.iv);
  assert.notDeepStrictEqual(a.ciphertext, b.ciphertext);
});

test('ciphertext diubah 1 bit -> dekripsi ditolak', async () => {
  const key = aes.generateKey();
  const { ciphertext, iv, authTag } = await runEncrypt(Buffer.from('hasil rontgen'), key);
  ciphertext[0] ^= 0x01;
  await assert.rejects(runDecrypt(ciphertext, key, iv, authTag));
});

test('kunci salah -> dekripsi ditolak', async () => {
  const { ciphertext, iv, authTag } = await runEncrypt(Buffer.from('no BPJS'), aes.generateKey());
  await assert.rejects(runDecrypt(ciphertext, aes.generateKey(), iv, authTag));
});
