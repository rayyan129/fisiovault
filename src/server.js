const app = require('./app');

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`FisioVault berjalan di http://localhost:${PORT}`);
});
