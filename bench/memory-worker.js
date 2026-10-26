// Dijalankan sebagai child process terpisah per cipher supaya pengukuran memori
// tidak tercampur sisa alokasi dari pengukuran lain.
// Argumen: <nama cipher> <stream|buffer> <path file input>
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const CIPHERS = require('./ciphers');

const [name, mode, inputPath] = process.argv.slice(2);
const MB = 1024 * 1024;

let base = 0;
let peak = 0;
function sample() {
  peak = Math.max(peak, process.memoryUsage().rss);
}
function resetPeak() {
  global.gc();
  base = process.memoryUsage().rss;
  peak = base;
}

async function streamMode() {
  const { mod, decryptArgs } = CIPHERS[name];
  const key = mod.generateKey();
  const ctPath = `${inputPath}.${mode}.${name}.enc`;
  const timer = setInterval(sample, 5);

  resetPeak();
  const meta = await mod.encrypt(fs.createReadStream(inputPath), fs.createWriteStream(ctPath), key);
  sample();
  const encPeak = peak - base;

  resetPeak();
  await mod.decrypt(fs.createReadStream(ctPath), fs.createWriteStream(os.devNull), ...decryptArgs(key, meta));
  sample();
  const decPeak = peak - base;

  clearInterval(timer);
  fs.rmSync(ctPath, { force: true });
  return { encPeak, decPeak };
}

// Pembanding: cara naif yang membaca file utuh ke memori (tidak dipakai aplikasi).
function bufferMode() {
  const key = crypto.randomBytes(32);
  const iv = crypto.randomBytes(12);

  resetPeak();
  const data = fs.readFileSync(inputPath);
  sample();
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  let ct = Buffer.concat([cipher.update(data), cipher.final()]);
  sample();
  const tag = cipher.getAuthTag();
  const encPeak = peak - base;

  resetPeak();
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  sample();
  const decPeak = peak - base;
  ct = null;
  return { encPeak, decPeak, ok: pt.length === data.length };
}

(async () => {
  const r = mode === 'buffer' ? bufferMode() : await streamMode();
  process.send({ encPeakMB: r.encPeak / MB, decPeakMB: r.decPeak / MB });
})();
