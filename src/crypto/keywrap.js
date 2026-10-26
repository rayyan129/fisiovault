const crypto = require('crypto');

// Envelope encryption: kunci data per file (AES/DES/RC4) dibungkus dengan
// master key AES-256-GCM dari environment, lalu hanya versi terbungkus yang
// disimpan di DB. Format hasil seal: IV (12) || auth tag (16) || ciphertext.
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

function getMasterKey() {
  const hex = process.env.FISIOVAULT_MASTER_KEY;
  if (!hex || !/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error('FISIOVAULT_MASTER_KEY wajib diisi: 64 karakter hex (32 byte). Lihat .env.example');
  }
  return Buffer.from(hex, 'hex');
}

// Enkripsi data kecil (kunci, metadata) di memori. `aad` mengikat hasil ke
// konteksnya (mis. ID file) supaya tidak bisa ditukar ke baris lain.
function seal(key, plaintext, aad) {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  if (aad) cipher.setAAD(Buffer.from(aad));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
}

function open(key, sealed, aad) {
  const iv = sealed.subarray(0, IV_LENGTH);
  const tag = sealed.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  if (aad) decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(sealed.subarray(IV_LENGTH + TAG_LENGTH)), decipher.final()]);
}

function wrapKey(dataKey, aad) {
  return seal(getMasterKey(), dataKey, aad);
}

function unwrapKey(wrapped, aad) {
  return open(getMasterKey(), wrapped, aad);
}

module.exports = { getMasterKey, seal, open, wrapKey, unwrapKey };
