const crypto = require('crypto');
const { pipeline } = require('stream/promises');

const ALGORITHM = 'rc4';
const KEY_LENGTH = 16; // 128 bit

// RC4 tidak memakai IV, jadi keunikan keystream hanya bergantung pada kunci.
// Karena itu setiap file WAJIB punya kunci acak sendiri.
function generateKey() {
  return crypto.randomBytes(KEY_LENGTH);
}

// Enkripsi data dari stream `input` ke stream `output`.
// Ciphertext = plaintext XOR keystream, tanpa padding dan tanpa IV.
// Mengembalikan objek kosong supaya interface sama dengan aes/des.
async function encrypt(input, output, key) {
  const cipher = crypto.createCipheriv(ALGORITHM, key, null);

  await pipeline(input, cipher, output);

  return {};
}

// Dekripsi = operasi XOR yang sama dengan keystream yang sama.
// RC4 tidak punya autentikasi dan tidak punya padding: kunci salah atau
// ciphertext yang diubah TIDAK pernah menimbulkan error.
async function decrypt(input, output, key) {
  const decipher = crypto.createDecipheriv(ALGORITHM, key, null);

  await pipeline(input, decipher, output);
}

module.exports = { generateKey, encrypt, decrypt, KEY_LENGTH };
