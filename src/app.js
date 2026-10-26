const express = require('express');
const cookieParser = require('cookie-parser');
const authRoutes = require('./routes/auth');
const fileRoutes = require('./routes/files');

const app = express();

app.use(express.json({ limit: '10kb' }));
app.use(cookieParser());

app.get('/', (req, res) => {
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
