const crypto = require('crypto');

// DES dan RC4 ada di OpenSSL 3 "legacy provider" yang tidak aktif secara default.
// Fungsi ini dipanggil saat server start supaya kesalahan konfigurasi langsung
// ketahuan, bukan baru muncul ketika pengguna mengunggah file.
function assertLegacyProvider() {
  try {
    crypto.createCipheriv('des-cbc', Buffer.alloc(8), Buffer.alloc(8));
    crypto.createCipheriv('rc4', Buffer.alloc(16), null);
  } catch (err) {
    if (err.code === 'ERR_OSSL_EVP_UNSUPPORTED') {
      throw new Error(
        'DES/RC4 tidak tersedia: jalankan Node dengan --openssl-legacy-provider ' +
          '(gunakan "npm start" / "npm run dev" / "npm test").'
      );
    }
    throw err;
  }
}

module.exports = { assertLegacyProvider };
