const express = require('express');
const argon2 = require('argon2');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const {
  SESSION_COOKIE,
  createSession,
  destroySession,
  cookieOptions,
} = require('../auth/sessions');

const router = express.Router();

const USERNAME_RE = /^[a-zA-Z0-9_.]{3,32}$/;
const MIN_PASSWORD = 8;
const MAX_PASSWORD = 128; // batas atas supaya hashing tidak bisa dipakai untuk DoS

// Dipakai saat username tidak ditemukan, supaya waktu respons login tetap sama
// dan penyerang tidak bisa menebak username mana yang terdaftar.
const DUMMY_HASH = argon2.hash('dummy-password-for-timing');

function validCredentials(username, password) {
  return (
    typeof username === 'string' &&
    typeof password === 'string' &&
    USERNAME_RE.test(username) &&
    password.length >= MIN_PASSWORD &&
    password.length <= MAX_PASSWORD
  );
}

router.post('/register', async (req, res) => {
  const { username, password } = req.body || {};
  if (!validCredentials(username, password)) {
    return res.status(400).json({
      error: `Username 3-32 karakter (huruf, angka, _ .), password ${MIN_PASSWORD}-${MAX_PASSWORD} karakter`,
    });
  }

  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  try {
    db.prepare('INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)').run(
      username,
      passwordHash,
      Date.now()
    );
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({ error: 'Username sudah dipakai' });
    }
    throw err;
  }
  res.status(201).json({ username });
});

router.post('/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (typeof username !== 'string' || typeof password !== 'string' || password.length > MAX_PASSWORD) {
    return res.status(400).json({ error: 'Username dan password wajib diisi' });
  }

  const user = db.prepare('SELECT id, username, password_hash FROM users WHERE username = ?').get(username);
  const ok = await argon2.verify(user ? user.password_hash : await DUMMY_HASH, password);
  if (!user || !ok) {
    // Pesan sama untuk username salah & password salah.
    return res.status(401).json({ error: 'Username atau password salah' });
  }

  // Selalu buat token baru saat login (mencegah session fixation).
  destroySession(req.cookies[SESSION_COOKIE]);
  res.cookie(SESSION_COOKIE, createSession(user.id), cookieOptions());
  res.json({ username: user.username });
});

router.post('/logout', (req, res) => {
  destroySession(req.cookies[SESSION_COOKIE]);
  res.clearCookie(SESSION_COOKIE, { ...cookieOptions(), maxAge: undefined });
  res.status(204).end();
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ username: req.user.username });
});

module.exports = router;
