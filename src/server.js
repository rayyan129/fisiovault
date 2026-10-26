const { assertLegacyProvider } = require('./crypto/legacy');
const app = require('./app');

assertLegacyProvider();

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`FisioVault berjalan di http://localhost:${PORT}`);
});
