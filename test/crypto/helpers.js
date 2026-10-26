const crypto = require('crypto');
const { Readable, PassThrough } = require('stream');

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function xor(a, b) {
  const out = Buffer.alloc(Math.min(a.length, b.length));
  for (let i = 0; i < out.length; i++) out[i] = a[i] ^ b[i];
  return out;
}

// Jalankan fungsi stream (encrypt/decrypt) pada Buffer di memori dan kumpulkan
// output-nya. Cukup untuk tes; aplikasi nanti memakai file/HTTP stream.
async function runStream(fn, data, args) {
  const chunks = [];
  const out = new PassThrough();
  out.on('data', (c) => chunks.push(c));
  const result = await fn(Readable.from([data]), out, ...args);
  return { output: Buffer.concat(chunks), result };
}

// Contoh: encryptBuffer(aes, plaintext, key) -> { ciphertext, iv, authTag }
async function encryptBuffer(cipherModule, plaintext, ...args) {
  const { output, result } = await runStream(cipherModule.encrypt, plaintext, args);
  return { ciphertext: output, ...result };
}

// Contoh: decryptBuffer(aes, ciphertext, key, iv, authTag) -> plaintext
async function decryptBuffer(cipherModule, ciphertext, ...args) {
  const { output } = await runStream(cipherModule.decrypt, ciphertext, args);
  return output;
}

module.exports = { sha256, xor, encryptBuffer, decryptBuffer };
