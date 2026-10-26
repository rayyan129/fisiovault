const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const { Readable, PassThrough } = require('stream');

const rc4 = require('../../src/crypto/rc4');

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function xor(a, b) {
  const out = Buffer.alloc(Math.min(a.length, b.length));
  for (let i = 0; i < out.length; i++) out[i] = a[i] ^ b[i];
  return out;
}

async function runEncrypt(plaintext, key) {
  const chunks = [];
  const out = new PassThrough();
  out.on('data', (c) => chunks.push(c));
  const meta = await rc4.encrypt(Readable.from([plaintext]), out, key);
  return { ciphertext: Buffer.concat(chunks), ...meta };
}

async function runDecrypt(ciphertext, key) {
  const chunks = [];
  const out = new PassThrough();
  out.on('data', (c) => chunks.push(c));
  await rc4.decrypt(Readable.from([ciphertext]), out, key);
  return Buffer.concat(chunks);
}

test('round-trip: hasil dekripsi identik (SHA-256 sama)', async () => {
  const plaintext = crypto.randomBytes(5 * 1024 * 1024 + 7);
  const key = rc4.generateKey();

  const { ciphertext } = await runEncrypt(plaintext, key);
  const decrypted = await runDecrypt(ciphertext, key);

  assert.strictEqual(sha256(decrypted), sha256(plaintext));
  assert.strictEqual(ciphertext.length, plaintext.length); // stream cipher: tanpa padding
});

test('round-trip: file kosong', async () => {
  const key = rc4.generateKey();
  const { ciphertext } = await runEncrypt(Buffer.alloc(0), key);
  assert.strictEqual(ciphertext.length, 0);
  assert.strictEqual((await runDecrypt(ciphertext, key)).length, 0);
});

test('kunci baru per file: data sama -> ciphertext berbeda', async () => {
  const data = Buffer.from('data pasien yang sama');
  const a = await runEncrypt(data, rc4.generateKey());
  const b = await runEncrypt(data, rc4.generateKey());
  assert.notDeepStrictEqual(a.ciphertext, b.ciphertext);
});

test('kunci salah -> tidak error, tapi hasilnya sampah', async () => {
  const plaintext = Buffer.from('no BPJS 0001234567890');
  const { ciphertext } = await runEncrypt(plaintext, rc4.generateKey());
  const decrypted = await runDecrypt(ciphertext, rc4.generateKey()); // tidak error
  assert.notDeepStrictEqual(decrypted, plaintext);
});

test('malleable: membalik 1 bit ciphertext membalik bit yang SAMA di plaintext', async () => {
  // Penyerang bisa mengubah isi secara terarah tanpa tahu kuncinya.
  const key = rc4.generateKey();
  const plaintext = Buffer.from('Sesi terapi: 2x/minggu');
  const { ciphertext } = await runEncrypt(plaintext, key);

  const pos = plaintext.indexOf('2');
  ciphertext[pos] ^= '2'.charCodeAt(0) ^ '9'.charCodeAt(0);

  const decrypted = await runDecrypt(ciphertext, key);
  assert.strictEqual(decrypted.toString(), 'Sesi terapi: 9x/minggu');
});

test('BAHAYA kunci dipakai ulang: C1 XOR C2 = P1 XOR P2', async () => {
  // Alasan aturan "kunci acak per file, jangan pernah dipakai ulang".
  const key = rc4.generateKey();
  const p1 = Buffer.from('Nama: Budi Santoso, BPJS 0001234567890');
  const p2 = Buffer.from('Nama: Siti Aminah,  BPJS 0009876543210');
  const c1 = (await runEncrypt(p1, key)).ciphertext;
  const c2 = (await runEncrypt(p2, key)).ciphertext;

  // Keystream saling meniadakan; tahu p1 berarti langsung tahu p2.
  assert.deepStrictEqual(xor(c1, c2), xor(p1, p2));
  assert.deepStrictEqual(xor(xor(c1, c2), p1), p2);
});
