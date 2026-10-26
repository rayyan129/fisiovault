const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const { Readable, PassThrough } = require('stream');

const des = require('../../src/crypto/des');

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

async function runEncrypt(plaintext, key) {
  const chunks = [];
  const out = new PassThrough();
  out.on('data', (c) => chunks.push(c));
  const meta = await des.encrypt(Readable.from([plaintext]), out, key);
  return { ciphertext: Buffer.concat(chunks), ...meta };
}

async function runDecrypt(ciphertext, key, iv) {
  const chunks = [];
  const out = new PassThrough();
  out.on('data', (c) => chunks.push(c));
  await des.decrypt(Readable.from([ciphertext]), out, key, iv);
  return Buffer.concat(chunks);
}

test('round-trip: hasil dekripsi identik (SHA-256 sama)', async () => {
  const plaintext = crypto.randomBytes(5 * 1024 * 1024 + 7);
  const key = des.generateKey();

  const { ciphertext, iv } = await runEncrypt(plaintext, key);
  const decrypted = await runDecrypt(ciphertext, key, iv);

  assert.strictEqual(sha256(decrypted), sha256(plaintext));
  assert.strictEqual(iv.length, 8);
});

test('padding PKCS#7: ciphertext dibulatkan ke kelipatan 8 byte', async () => {
  const key = des.generateKey();
  // 0 byte -> 8, 7 -> 8, 8 -> 16 (kelipatan pas tetap dapat 1 blok padding penuh)
  for (const [len, expected] of [[0, 8], [7, 8], [8, 16], [13, 16]]) {
    const { ciphertext, iv } = await runEncrypt(Buffer.alloc(len, 0x41), key);
    assert.strictEqual(ciphertext.length, expected, `plaintext ${len} byte`);
    const decrypted = await runDecrypt(ciphertext, key, iv);
    assert.strictEqual(decrypted.length, len);
  }
});

test('IV berbeda setiap enkripsi walau kunci & data sama', async () => {
  const key = des.generateKey();
  const data = Buffer.from('data pasien yang sama');
  const a = await runEncrypt(data, key);
  const b = await runEncrypt(data, key);
  assert.notDeepStrictEqual(a.iv, b.iv);
  assert.notDeepStrictEqual(a.ciphertext, b.ciphertext);
});

test('kunci salah -> plaintext tidak didapat', async () => {
  const plaintext = Buffer.from('no BPJS 0001234567890');
  const { ciphertext, iv } = await runEncrypt(plaintext, des.generateKey());
  // Biasanya error "bad decrypt" (padding rusak); kalau kebetulan padding valid,
  // hasilnya tetap sampah. Keduanya berarti plaintext tidak bocor.
  try {
    const decrypted = await runDecrypt(ciphertext, des.generateKey(), iv);
    assert.notDeepStrictEqual(decrypted, plaintext);
  } catch (err) {
    assert.match(err.message, /bad decrypt/);
  }
});

test('CBC tanpa autentikasi: ciphertext diubah TIDAK terdeteksi', async () => {
  // Pembanding untuk AES-GCM yang menolak perubahan 1 bit.
  const key = des.generateKey();
  const plaintext = Buffer.from('Diagnosis: low back pain, terapi 2x/minggu');
  const { ciphertext, iv } = await runEncrypt(plaintext, key);

  ciphertext[0] ^= 0x01; // ubah blok pertama, blok padding terakhir tetap utuh

  const decrypted = await runDecrypt(ciphertext, key, iv); // tidak error
  assert.notDeepStrictEqual(decrypted, plaintext);
  assert.strictEqual(decrypted.length, plaintext.length);
});
