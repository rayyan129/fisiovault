const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

process.env.DB_PATH = ':memory:';
process.env.STORAGE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'fisiovault-test-'));
process.env.FISIOVAULT_MASTER_KEY = crypto.randomBytes(32).toString('hex');

const test = require('node:test');
const assert = require('node:assert');

const app = require('../src/app');
const db = require('../src/db');
const vault = require('../src/services/vault');
const { sha256 } = require('./crypto/helpers');

let server;
let base;
let cookieA;
let cookieB;

async function login(username) {
  const body = JSON.stringify({ username, password: 'rahasia-kuat-123' });
  const headers = { 'Content-Type': 'application/json' };
  await fetch(`${base}/auth/register`, { method: 'POST', headers, body });
  const res = await fetch(`${base}/auth/login`, { method: 'POST', headers, body });
  return res.headers.get('set-cookie').split(';')[0];
}

function upload(cookie, content, filename) {
  const form = new FormData();
  form.append('file', new Blob([content]), filename);
  return fetch(`${base}/files`, { method: 'POST', headers: cookie ? { Cookie: cookie } : {}, body: form });
}

function request(method, p, cookie, body) {
  const headers = { Cookie: cookie };
  if (body) headers['Content-Type'] = 'application/json';
  return fetch(base + p, { method, headers, body: body && JSON.stringify(body) });
}

test.before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://localhost:${server.address().port}`;
  cookieA = await login('pasien_a');
  cookieB = await login('pasien_b');
});

test.after(() => {
  server.close();
  fs.rmSync(process.env.STORAGE_DIR, { recursive: true, force: true });
});

// Penanda plaintext yang tidak boleh muncul di storage maupun DB.
const MARKER = 'RAHASIA-RONTGEN-BUDI';
const FILENAME = 'hasil_rontgen_budi_santoso.pdf';
const content = Buffer.concat([Buffer.from(MARKER), crypto.randomBytes(3 * 1024 * 1024 + 5)]);
let fileId;

test('upload tanpa login ditolak', async () => {
  assert.strictEqual((await upload(null, content, FILENAME)).status, 401);
});

test('upload -> disimpan terenkripsi 3x', async () => {
  const res = await upload(cookieA, content, FILENAME);
  assert.strictEqual(res.status, 201);
  const body = await res.json();
  fileId = body.id;
  assert.strictEqual(body.name, FILENAME);
  assert.strictEqual(body.mime, 'application/pdf');
  assert.strictEqual(body.size, content.length);

  const sizes = Object.fromEntries(vault.ALGOS.map((a) => [a, fs.statSync(vault.storagePath(fileId, a)).size]));
  assert.strictEqual(sizes.aes, content.length); // GCM: tanpa padding
  assert.strictEqual(sizes.des, (Math.floor(content.length / 8) + 1) * 8); // PKCS#7
  assert.strictEqual(sizes.rc4, content.length); // stream cipher
});

test('tidak ada plaintext di storage maupun DB', async () => {
  for (const algo of vault.ALGOS) {
    const stored = fs.readFileSync(vault.storagePath(fileId, algo));
    assert.ok(!stored.includes(MARKER), `${algo}: penanda bocor`);
  }
  const dbBytes = db.serialize();
  assert.ok(!dbBytes.includes(FILENAME), 'nama file bocor di DB');
  assert.ok(!dbBytes.includes(sha256(content)), 'hash plaintext bocor di DB');
});

test('download dengan AES, DES, dan RC4 -> SHA-256 identik dengan aslinya', async () => {
  for (const algo of vault.ALGOS) {
    const res = await request('GET', `/files/${fileId}/download?algo=${algo}`, cookieA);
    assert.strictEqual(res.status, 200, algo);
    assert.strictEqual(res.headers.get('content-type'), 'application/pdf');
    const downloaded = Buffer.from(await res.arrayBuffer());
    assert.strictEqual(sha256(downloaded), sha256(content), algo);
  }
});

test('daftar file hanya milik sendiri; user lain tidak bisa download/hapus', async () => {
  const listA = await (await request('GET', '/files', cookieA)).json();
  const listB = await (await request('GET', '/files', cookieB)).json();
  assert.ok(listA.some((f) => f.id === fileId));
  assert.deepStrictEqual(listB, []);

  assert.strictEqual((await request('GET', `/files/${fileId}/download`, cookieB)).status, 404);
  assert.strictEqual((await request('DELETE', `/files/${fileId}`, cookieB)).status, 404);
});

test('tipe file tidak diizinkan -> 415, algo tidak dikenal -> 400', async () => {
  assert.strictEqual((await upload(cookieA, Buffer.from('MZ...'), 'virus.exe')).status, 415);
  assert.strictEqual((await request('GET', `/files/${fileId}/download?algo=ecb`, cookieA)).status, 400);
});

test('ciphertext di storage diubah -> unduhan gagal untuk ketiga cipher', async () => {
  const small = Buffer.from('Program latihan: squat 3x10, bridging 3x12');
  const id = (await (await upload(cookieA, small, 'program.docx')).json()).id;

  for (const algo of vault.ALGOS) {
    const p = vault.storagePath(id, algo);
    const bytes = fs.readFileSync(p);
    bytes[0] ^= 0x01;
    fs.writeFileSync(p, bytes);

    // Koneksi diputus sebelum chunk terakhir terkirim -> isi tidak pernah utuh.
    // (Untuk file kecil, koneksi sudah putus sebelum header terkirim.)
    await assert.rejects(async () => {
      const res = await request('GET', `/files/${id}/download?algo=${algo}`, cookieA);
      await res.arrayBuffer();
    }, `${algo}: perubahan tidak terdeteksi`);
  }
});

test('form data pribadi: disimpan terenkripsi dan bisa diunduh kembali', async () => {
  const data = {
    nama: 'Budi Santoso',
    tanggal_lahir: '1990-05-17',
    no_hp: '081234567890',
    alamat: 'Jl. Contoh No. 1, Surabaya',
    no_bpjs: '0001234567890',
    diagnosis: 'Low back pain',
  };
  const res = await request('POST', '/files/form', cookieA, data);
  assert.strictEqual(res.status, 201);
  const { id, kind } = await res.json();
  assert.strictEqual(kind, 'form');

  for (const algo of vault.ALGOS) {
    assert.ok(!fs.readFileSync(vault.storagePath(id, algo)).includes('0001234567890'));
  }
  assert.ok(!db.serialize().includes('Budi Santoso'));

  const back = await (await request('GET', `/files/${id}/download?algo=des`, cookieA)).json();
  assert.deepStrictEqual(back, data);

  const bad = await request('POST', '/files/form', cookieA, { ...data, no_bpjs: '123' });
  assert.strictEqual(bad.status, 400);
});

test('kunci terbungkus terikat ke file-nya: ditukar ke file lain -> ditolak', async () => {
  const id2 = (await (await upload(cookieA, Buffer.from('scan KTP'), 'ktp.png')).json()).id;
  const other = db.prepare('SELECT aes_key FROM files WHERE id = ?').get(fileId);
  db.prepare('UPDATE files SET aes_key = ? WHERE id = ?').run(other.aes_key, id2);
  assert.strictEqual((await request('GET', `/files/${id2}`, cookieA)).status, 500);
});

test('hapus file -> baris DB dan ketiga file storage hilang', async () => {
  assert.strictEqual((await request('DELETE', `/files/${fileId}`, cookieA)).status, 204);
  assert.strictEqual(db.prepare('SELECT 1 FROM files WHERE id = ?').get(fileId), undefined);
  for (const algo of vault.ALGOS) assert.ok(!fs.existsSync(vault.storagePath(fileId, algo)));
});
