const express = require('express');
const cookieParser = require('cookie-parser');
const authRoutes = require('./routes/auth');

const app = express();

app.use(express.json({ limit: '10kb' }));
app.use(cookieParser());

app.get('/', (req, res) => {
  res.send('FisioVault jalan');
});

app.use('/auth', authRoutes);

module.exports = app;
