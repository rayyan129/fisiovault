const crypto = require('crypto');
const { pipeline } = require('stream/promises');

const ALGORITHM = 'des-cbc';
const KEY_LENGTH = 8; // 64 bit, efektif 56 bit (8 bit paritas)
const IV_LENGTH = 8; // sama dengan ukuran blok DES

function generateKey() {
  return crypto.randomBytes(KEY_LENGTH);
}

// Enkripsi data dari stream `input` ke stream `output`.
// IV dibuat acak di sini supaya setiap file punya IV unik.
// Padding PKCS#7 diterapkan otomatis oleh OpenSSL (autoPadding aktif secara default).
// Mengembalikan { iv } yang wajib disimpan untuk dekripsi.
async function encrypt(input, output, key) {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  await pipeline(input, cipher, output);

  return { iv };
}

// Dekripsi dari stream `input` ke stream `output`.
// CBC tidak punya autentikasi: perubahan ciphertext umumnya TIDAK terdeteksi.
// Error hanya muncul kalau padding di blok terakhir tidak valid.
async function decrypt(input, output, key, iv) {
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);

  await pipeline(input, decipher, output);
}

module.exports = { generateKey, encrypt, decrypt, KEY_LENGTH, IV_LENGTH };
