const db = require('../db');
const { SESSION_COOKIE, findUserBySession } = require('../auth/sessions');

// Wajib login: mengisi req.user dari cookie sesi, atau menolak dengan 401.
function requireAuth(req, res, next) {
  const user = findUserBySession(req.cookies[SESSION_COOKIE]);
  if (!user) return res.status(401).json({ error: 'Harus login' });
  req.user = user;
  next();
}

// Wajib pemilik file: dipasang setelah requireAuth pada route /:id.
// File milik orang lain dijawab 404 (bukan 403) supaya penyerang tidak bisa
// menebak ID file mana yang ada.
function requireFileOwner(req, res, next) {
  const file = db
    .prepare('SELECT * FROM files WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.user.id);
  if (!file) return res.status(404).json({ error: 'File tidak ditemukan' });
  req.file = file;
  next();
}

module.exports = { requireAuth, requireFileOwner };
