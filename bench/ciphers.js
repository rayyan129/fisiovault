// Daftar cipher yang dibandingkan, memakai modul yang SAMA dengan aplikasi.
const aes = require('../src/crypto/aes');
const des = require('../src/crypto/des');
const rc4 = require('../src/crypto/rc4');

module.exports = {
  'AES-256-GCM': {
    mod: aes,
    decryptArgs: (key, meta) => [key, meta.iv, meta.authTag],
    metaBytes: (meta) => meta.iv.length + meta.authTag.length, // IV + tag disimpan di DB
  },
  'DES-CBC': {
    mod: des,
    decryptArgs: (key, meta) => [key, meta.iv],
    metaBytes: (meta) => meta.iv.length,
  },
  RC4: {
    mod: rc4,
    decryptArgs: (key) => [key],
    metaBytes: () => 0,
  },
};
