const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

// DB_PATH=':memory:' dipakai tes supaya tidak menyentuh database asli.
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', '..', 'data', 'fisiovault.db');

if (DB_PATH !== ':memory:') {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
}

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    created_at    INTEGER NOT NULL
  );

  -- Yang disimpan hanya SHA-256 dari token sesi, bukan token aslinya.
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );

  -- Satu baris = satu dokumen, disimpan 3x (AES, DES, RC4) di storage/<id>.<algo>.
  -- Kolom *_key berisi kunci per file yang DIBUNGKUS master key (bukan kunci mentah).
  -- meta = {nama file, mime, sha256 plaintext} terenkripsi AES-GCM.
  CREATE TABLE IF NOT EXISTS files (
    id         TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind       TEXT NOT NULL CHECK (kind IN ('upload', 'form')),
    size       INTEGER NOT NULL,
    meta       BLOB NOT NULL,
    aes_key    BLOB NOT NULL,
    aes_iv     BLOB NOT NULL,
    aes_tag    BLOB NOT NULL,
    des_key    BLOB NOT NULL,
    des_iv     BLOB NOT NULL,
    rc4_key    BLOB NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_files_user ON files(user_id);
`);

module.exports = db;
