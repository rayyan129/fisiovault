const express = require('express');

const app = express();

app.get('/', (req, res) => {
  res.send('FisioVault jalan');
});

module.exports = app;
