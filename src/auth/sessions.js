const crypto = require('crypto');
const db = require('../db');

const SESSION_COOKIE = 'sid';
const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8 jam

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// Membuat sesi baru dan mengembalikan token mentah (hanya dikirim ke browser via cookie).
function createSession(userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(
    hashToken(token),
    userId,
    Date.now() + SESSION_TTL_MS
  );
  return token;
}

// Mengembalikan user pemilik token, atau null kalau token tidak ada / kedaluwarsa.
function findUserBySession(token) {
  if (!token) return null;
  const row = db
    .prepare(
      `SELECT u.id, u.username, s.expires_at FROM sessions s
       JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`
    )
    .get(hashToken(token));
  if (!row) return null;
  if (row.expires_at < Date.now()) {
    destroySession(token);
    return null;
  }
  return { id: row.id, username: row.username };
}

function destroySession(token) {
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
}

function cookieOptions() {
  return {
    httpOnly: true, // tidak bisa dibaca JavaScript (mitigasi pencurian via XSS)
    sameSite: 'lax', // tidak dikirim pada POST lintas situs (mitigasi CSRF)
    secure: process.env.NODE_ENV === 'production', // hanya lewat HTTPS saat produksi
    maxAge: SESSION_TTL_MS,
    path: '/',
  };
}

module.exports = { SESSION_COOKIE, createSession, findUserBySession, destroySession, cookieOptions };
