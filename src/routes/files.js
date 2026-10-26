const path = require('path');
const { Readable } = require('stream');
const express = require('express');
const busboy = require('busboy');

const vault = require('../services/vault');
const { requireAuth, requireFileOwner } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

const MAX_UPLOAD_BYTES = 1024 * 1024 * 1024; // 1 GB (video latihan)

// Tipe ditentukan dari ekstensi yang diizinkan, bukan dari Content-Type kiriman
// browser (yang bisa dipalsukan).
const ALLOWED_TYPES = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.mp4': 'video/mp4',
};

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

// Menunggu field "file" dari multipart dan mengembalikan stream-nya (tanpa
// menulis file sementara ke disk).
function receiveFile(req) {
  return new Promise((resolve, reject) => {
    let bb;
    try {
      bb = busboy({ headers: req.headers, limits: { files: 1, fileSize: MAX_UPLOAD_BYTES } });
    } catch {
      return reject(httpError(400, 'Request harus multipart/form-data'));
    }
    let received = false;
    bb.on('file', (field, stream, info) => {
      if (field !== 'file' || received) return stream.resume();
      received = true;
      resolve({ stream, filename: info.filename });
    });
    bb.on('error', reject);
    bb.on('close', () => {
      if (!received) reject(httpError(400, 'Field "file" wajib ada'));
    });
    req.pipe(bb);
  });
}

router.post('/', async (req, res) => {
  const { stream, filename } = await receiveFile(req);
  const name = path.basename(filename || '').slice(0, 255);
  const mime = ALLOWED_TYPES[path.extname(name).toLowerCase()];
  if (!mime) {
    stream.resume();
    return res.status(415).json({ error: 'Tipe file harus JPG, PNG, PDF, DOCX, atau MP4' });
  }

  const file = await vault.storeFile(req.user.id, stream, { kind: 'upload', name, mime });
  if (stream.truncated) {
    await vault.deleteFile(file.id);
    return res.status(413).json({ error: 'File melebihi 1 GB' });
  }
  res.status(201).json(file);
});

const FORM_RULES = {
  nama: /^.{1,100}$/,
  tanggal_lahir: /^\d{4}-\d{2}-\d{2}$/,
  no_hp: /^\+?[0-9]{8,15}$/,
  alamat: /^.{1,300}$/s,
  no_bpjs: /^\d{13}$/,
  diagnosis: /^.{1,500}$/s,
};

// Data pribadi dari form disimpan sebagai dokumen JSON terenkripsi, lewat
// jalur enkripsi yang sama dengan file upload.
router.post('/form', async (req, res) => {
  const body = req.body || {};
  const data = {};
  for (const [field, rule] of Object.entries(FORM_RULES)) {
    if (typeof body[field] !== 'string' || !rule.test(body[field])) {
      return res.status(400).json({ error: `Field "${field}" tidak valid` });
    }
    data[field] = body[field];
  }

  const buf = Buffer.from(JSON.stringify(data), 'utf8');
  const file = await vault.storeFile(req.user.id, Readable.from([buf]), {
    kind: 'form',
    name: 'data-pribadi.json',
    mime: 'application/json',
  });
  res.status(201).json(file);
});

router.get('/', (req, res) => {
  res.json(vault.listFiles(req.user.id));
});

router.get('/:id', requireFileOwner, (req, res) => {
  res.json(vault.describe(req.file));
});

router.get('/:id/download', requireFileOwner, async (req, res) => {
  const algo = req.query.algo || 'aes';
  if (!vault.ALGOS.includes(algo)) {
    return res.status(400).json({ error: 'algo harus aes, des, atau rc4' });
  }

  const { name, mime } = vault.readMeta(req.file);
  res.set({
    'Content-Type': mime,
    'Content-Length': req.file.size,
    'Content-Disposition': `attachment; filename="download${path.extname(name)}"; filename*=UTF-8''${encodeURIComponent(name)}`,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store',
  });

  try {
    await vault.decryptTo(req.file, algo, res);
  } catch (err) {
    // Header sudah terkirim: putuskan koneksi supaya klien tahu unduhan gagal.
    console.error(`Dekripsi gagal (file ${req.file.id}, ${algo}): ${err.message}`);
    res.destroy();
  }
});

router.delete('/:id', requireFileOwner, async (req, res) => {
  await vault.deleteFile(req.file.id);
  res.status(204).end();
});

module.exports = router;
