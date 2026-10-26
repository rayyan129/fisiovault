const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');
const authRoutes = require('./routes/auth');
const fileRoutes = require('./routes/files');

const app = express();

// CSP: hanya script/style dari server sendiri (tanpa inline script, tanpa CDN),
// lapisan pertahanan tambahan terhadap XSS.
app.use((req, res, next) => {
  res.set({
    'Content-Security-Policy':
      "default-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  });
  next();
});

app.use(express.json({ limit: '10kb' }));
app.use(cookieParser());

// Frontend statis (tidak berisi data pasien apa pun).
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/health', (req, res) => {
  res.send('FisioVault jalan');
});

app.use('/auth', authRoutes);
app.use('/files', fileRoutes);

// Pesan error ke klien dibuat umum; log hanya berisi pesan error, bukan isi data.
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  if (err.status) return res.status(err.status).json({ error: err.message });
  console.error(err.message);
  res.status(500).json({ error: 'Terjadi kesalahan di server' });
});

module.exports = app;
