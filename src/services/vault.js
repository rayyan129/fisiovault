const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { PassThrough, Transform } = require('stream');
const { pipeline } = require('stream/promises');

const db = require('../db');
const aes = require('../crypto/aes');
const des = require('../crypto/des');
const rc4 = require('../crypto/rc4');
const { seal, open, wrapKey, unwrapKey } = require('../crypto/keywrap');

const STORAGE_DIR = process.env.STORAGE_DIR || path.join(__dirname, '..', '..', 'storage');
fs.mkdirSync(STORAGE_DIR, { recursive: true });

const CIPHERS = { aes, des, rc4 };
const ALGOS = Object.keys(CIPHERS);

// Nama file di storage hanya UUID acak + algoritma: tidak membocorkan nama asli.
function storagePath(id, algo) {
  return path.join(STORAGE_DIR, `${id}.${algo}`);
}

function removeStored(id) {
  return Promise.all(ALGOS.map((a) => fsp.rm(storagePath(id, a), { force: true })));
}

// Satu stream plaintext dicabang ke tiga cipher sekaligus (dibaca sekali),
// jadi plaintext tidak pernah ditulis ke disk maupun ditampung utuh di memori.
async function storeFile(userId, input, { kind, name, mime }) {
  const id = crypto.randomUUID();
  const keys = { aes: aes.generateKey(), des: des.generateKey(), rc4: rc4.generateKey() };
  const hash = crypto.createHash('sha256');
  let size = 0;

  const branches = ALGOS.map(() => new PassThrough());
  input.on('data', (chunk) => {
    hash.update(chunk);
    size += chunk.length;
  });
  input.on('error', (err) => branches.forEach((b) => b.destroy(err)));
  branches.forEach((b) => input.pipe(b));

  const results = await Promise.allSettled(
    ALGOS.map((algo, i) =>
      CIPHERS[algo].encrypt(branches[i], fs.createWriteStream(storagePath(id, algo), { flags: 'wx' }), keys[algo])
    )
  );
  const failed = results.find((r) => r.status === 'rejected');
  if (failed) {
    branches.forEach((b) => b.destroy());
    await removeStored(id);
    throw failed.reason;
  }
  const [aesMeta, desMeta] = results.map((r) => r.value);

  // Nama file, tipe, dan hash plaintext ikut dienkripsi (bukan plaintext di DB).
  const meta = { name, mime, sha256: hash.digest('hex') };

  db.prepare(
    `INSERT INTO files (id, user_id, kind, size, meta, aes_key, aes_iv, aes_tag,
                        des_key, des_iv, rc4_key, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    userId,
    kind,
    size,
    seal(keys.aes, JSON.stringify(meta), `${id}:meta`),
    wrapKey(keys.aes, `${id}:aes`),
    aesMeta.iv,
    aesMeta.authTag,
    wrapKey(keys.des, `${id}:des`),
    desMeta.iv,
    wrapKey(keys.rc4, `${id}:rc4`),
    Date.now()
  );

  return { id, kind, name, mime, size };
}

function readMeta(row) {
  const aesKey = unwrapKey(row.aes_key, `${row.id}:aes`);
  return JSON.parse(open(aesKey, row.meta, `${row.id}:meta`).toString('utf8'));
}

function describe(row) {
  const { name, mime } = readMeta(row);
  return { id: row.id, kind: row.kind, name, mime, size: row.size, createdAt: row.created_at };
}

function listFiles(userId) {
  return db
    .prepare('SELECT * FROM files WHERE user_id = ? ORDER BY created_at DESC')
    .all(userId)
    .map(describe);
}

// Meneruskan plaintext sambil menghitung SHA-256. Chunk terakhir ditahan sampai
// hash terbukti cocok, jadi file yang rusak/diubah tidak pernah terkirim utuh.
// Ini juga memberi DES & RC4 cek integritas di level aplikasi.
function createVerifier(expectedSha256) {
  const hash = crypto.createHash('sha256');
  let held = null;
  return new Transform({
    transform(chunk, _enc, cb) {
      hash.update(chunk);
      const prev = held;
      held = chunk;
      cb(null, prev || undefined);
    },
    flush(cb) {
      if (hash.digest('hex') !== expectedSha256) {
        return cb(new Error('Integritas gagal: SHA-256 hasil dekripsi tidak cocok'));
      }
      cb(null, held || undefined);
    },
  });
}

async function decryptTo(row, algo, output) {
  const key = unwrapKey(row[`${algo}_key`], `${row.id}:${algo}`);
  const args = { aes: [key, row.aes_iv, row.aes_tag], des: [key, row.des_iv], rc4: [key] }[algo];
  const verifier = createVerifier(readMeta(row).sha256);

  await Promise.all([
    CIPHERS[algo].decrypt(fs.createReadStream(storagePath(row.id, algo)), verifier, ...args),
    pipeline(verifier, output),
  ]);
}

async function deleteFile(id) {
  db.prepare('DELETE FROM files WHERE id = ?').run(id);
  await removeStored(id);
}

module.exports = { ALGOS, STORAGE_DIR, storagePath, storeFile, readMeta, describe, listFiles, decryptTo, deleteFile };
