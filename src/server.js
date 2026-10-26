const { assertLegacyProvider } = require('./crypto/legacy');
const { getMasterKey } = require('./crypto/keywrap');

assertLegacyProvider();
getMasterKey(); // berhenti di awal kalau master key belum diatur

const app = require('./app');

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`FisioVault berjalan di http://localhost:${PORT}`);
});
