process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert');
const express = require('express');

const app = require('../src/app');
const db = require('../src/db');
const { requireAuth, requireFileOwner } = require('../src/middleware/auth');

// Route dummy khusus tes untuk menguji middleware kepemilikan sebelum
// route file asli dibuat di langkah 4.
app.get('/test-files/:id', requireAuth, requireFileOwner, (req, res) => {
  res.json({ id: req.file.id });
});

let server;
let base;

test.before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://localhost:${server.address().port}`;
});

test.after(() => server.close());

function post(path, body, cookie) {
  return fetch(base + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(cookie && { Cookie: cookie }) },
    body: JSON.stringify(body),
  });
}

function get(path, cookie) {
  return fetch(base + path, { headers: cookie ? { Cookie: cookie } : {} });
}

function sessionCookie(res) {
  return res.headers.get('set-cookie').split(';')[0]; // "sid=..."
}

async function registerAndLogin(username, password = 'rahasia-kuat-123') {
  await post('/auth/register', { username, password });
  const res = await post('/auth/login', { username, password });
  return sessionCookie(res);
}

test('register berhasil, password disimpan sebagai hash argon2id', async () => {
  const res = await post('/auth/register', { username: 'pasien1', password: 'rahasia-kuat-123' });
  assert.strictEqual(res.status, 201);

  const row = db.prepare('SELECT password_hash FROM users WHERE username = ?').get('pasien1');
  assert.match(row.password_hash, /^\$argon2id\$/);
  assert.ok(!row.password_hash.includes('rahasia-kuat-123'));
});

test('register: username dobel ditolak (tidak peka huruf besar/kecil)', async () => {
  const res = await post('/auth/register', { username: 'PASIEN1', password: 'rahasia-kuat-123' });
  assert.strictEqual(res.status, 409);
});

test('register: password terlalu pendek / input aneh ditolak', async () => {
  assert.strictEqual((await post('/auth/register', { username: 'pasien2', password: 'pendek' })).status, 400);
  assert.strictEqual((await post('/auth/register', { username: 'a b', password: 'rahasia-kuat-123' })).status, 400);
  assert.strictEqual((await post('/auth/register', { username: ['x'], password: 'rahasia-kuat-123' })).status, 400);
});

test('login: password salah dan username tak dikenal -> pesan sama', async () => {
  const a = await post('/auth/login', { username: 'pasien1', password: 'salah-salah-salah' });
  const b = await post('/auth/login', { username: 'tidak_ada', password: 'salah-salah-salah' });
  assert.strictEqual(a.status, 401);
  assert.strictEqual(b.status, 401);
  assert.deepStrictEqual(await a.json(), await b.json());
});

test('login: cookie HttpOnly + SameSite, token tidak disimpan mentah di DB', async () => {
  const res = await post('/auth/login', { username: 'pasien1', password: 'rahasia-kuat-123' });
  assert.strictEqual(res.status, 200);
  const setCookie = res.headers.get('set-cookie');
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /SameSite=Lax/i);

  const token = sessionCookie(res).slice('sid='.length);
  const found = db.prepare('SELECT 1 FROM sessions WHERE token_hash = ?').get(token);
  assert.strictEqual(found, undefined);
});

test('/auth/me: tanpa login 401, dengan login 200', async () => {
  assert.strictEqual((await get('/auth/me')).status, 401);
  const cookie = await registerAndLogin('pasien3');
  const res = await get('/auth/me', cookie);
  assert.strictEqual(res.status, 200);
  assert.deepStrictEqual(await res.json(), { username: 'pasien3' });
});

test('logout: sesi dihapus, cookie lama tidak bisa dipakai lagi', async () => {
  const cookie = await registerAndLogin('pasien4');
  assert.strictEqual((await post('/auth/logout', {}, cookie)).status, 204);
  assert.strictEqual((await get('/auth/me', cookie)).status, 401);
});

test('sesi kedaluwarsa ditolak', async () => {
  const cookie = await registerAndLogin('pasien5');
  db.prepare('UPDATE sessions SET expires_at = ?').run(Date.now() - 1);
  assert.strictEqual((await get('/auth/me', cookie)).status, 401);
});

test('kepemilikan file: pemilik boleh, user lain dapat 404', async () => {
  const cookieA = await registerAndLogin('pemilik_a');
  const cookieB = await registerAndLogin('penyusup_b');
  const userA = db.prepare('SELECT id FROM users WHERE username = ?').get('pemilik_a');
  db.prepare(
    `INSERT INTO files (id, user_id, kind, size, meta, aes_key, aes_iv, aes_tag, des_key, des_iv, rc4_key, created_at)
     VALUES (?, ?, 'upload', 0, x'', x'', x'', x'', x'', x'', x'', ?)`
  ).run('file-a', userA.id, Date.now());

  assert.strictEqual((await get('/test-files/file-a', cookieA)).status, 200);
  assert.strictEqual((await get('/test-files/file-a', cookieB)).status, 404); // bukan 403
  assert.strictEqual((await get('/test-files/tidak-ada', cookieA)).status, 404);
  assert.strictEqual((await get('/test-files/file-a')).status, 401); // tanpa login
});
