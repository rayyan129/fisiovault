const crypto = require('crypto');
const { pipeline } = require('stream/promises');

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32; // 256 bit
const IV_LENGTH = 12; // 96 bit, panjang IV yang direkomendasikan untuk GCM

function generateKey() {
  return crypto.randomBytes(KEY_LENGTH);
}

// Enkripsi data dari stream `input` ke stream `output`.
// IV dibuat acak di sini supaya tidak mungkin dipakai ulang untuk kunci yang sama.
// Mengembalikan { iv, authTag } yang wajib disimpan untuk dekripsi.
async function encrypt(input, output, key) {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  await pipeline(input, cipher, output);

  return { iv, authTag: cipher.getAuthTag() };
}

// Dekripsi dari stream `input` ke stream `output`.
// Auth tag dicek saat stream selesai: kalau ciphertext diubah atau kuncinya salah,
// pipeline akan gagal (reject). Pemanggil harus membuang output yang sudah tertulis.
async function decrypt(input, output, key, iv, authTag) {
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  await pipeline(input, decipher, output);
}

module.exports = { generateKey, encrypt, decrypt, KEY_LENGTH, IV_LENGTH };
