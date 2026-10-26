// Benchmark AES-256-GCM vs DES-CBC vs RC4 (OpenSSL yang sama via modul crypto Node).
// Mengukur: waktu enkripsi/dekripsi, throughput, memori puncak, overhead ukuran,
// dan integritas round-trip (SHA-256).
//
//   npm run bench            -> ukuran 1 KB s.d. 100 MB, file memori 256 MB
//   npm run bench -- --quick -> versi cepat untuk cek skrip
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { fork } = require('child_process');
const { Readable, Writable } = require('stream');

const { assertLegacyProvider } = require('../src/crypto/legacy');
const CIPHERS = require('./ciphers');

assertLegacyProvider();

const KB = 1024;
const MB = 1024 * KB;
const QUICK = process.argv.includes('--quick');

// Ukuran mewakili jenis data di aplikasi.
const SIZES = [
  { label: '1 KB (form data pribadi)', bytes: 1 * KB },
  { label: '100 KB (scan KTP/BPJS)', bytes: 100 * KB },
  { label: '1 MB (PDF rujukan)', bytes: 1 * MB },
  { label: '10 MB (rontgen/DOCX besar)', bytes: 10 * MB },
  ...(QUICK ? [] : [{ label: '100 MB (video latihan)', bytes: 100 * MB }]),
];
const MEMORY_FILE_BYTES = (QUICK ? 32 : 256) * MB;
const CHUNK = 64 * KB; // ukuran potongan stream, sama dengan default fs.createReadStream

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function source(buf) {
  return Readable.from(
    (function* () {
      for (let i = 0; i < buf.length; i += CHUNK) yield buf.subarray(i, i + CHUNK);
    })()
  );
}

function sink(collect) {
  const chunks = [];
  const w = new Writable({
    write(chunk, _enc, cb) {
      if (collect) chunks.push(chunk);
      cb();
    },
  });
  w.result = () => Buffer.concat(chunks);
  return w;
}

async function timeMs(fn) {
  const start = process.hrtime.bigint();
  await fn();
  return Number(process.hrtime.bigint() - start) / 1e6;
}

function stats(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const sd = Math.sqrt(values.reduce((a, v) => a + (v - mean) ** 2, 0) / values.length);
  return { median, mean, sd };
}

// File kecil diulang lebih banyak supaya waktunya terukur stabil.
function runsFor(bytes) {
  return Math.min(200, Math.max(5, Math.ceil((QUICK ? 20 : 200) * MB / bytes / 10)));
}

async function benchSpeed() {
  const rows = [];
  for (const size of SIZES) {
    const plaintext = crypto.randomBytes(size.bytes);
    const runs = runsFor(size.bytes);

    for (const [name, { mod, decryptArgs, metaBytes }] of Object.entries(CIPHERS)) {
      const key = mod.generateKey();

      // Round-trip tidak diukur waktunya: untuk integritas & overhead ukuran.
      const encOut = sink(true);
      const meta = await mod.encrypt(source(plaintext), encOut, key);
      const ciphertext = encOut.result();
      const decOut = sink(true);
      await mod.decrypt(source(ciphertext), decOut, ...decryptArgs(key, meta));
      const integrity = sha256(decOut.result()) === sha256(plaintext);

      const enc = [];
      const dec = [];
      for (let i = 0; i <= runs; i++) {
        const e = await timeMs(() => mod.encrypt(source(plaintext), sink(false), key));
        const d = await timeMs(() => mod.decrypt(source(ciphertext), sink(false), ...decryptArgs(key, meta)));
        if (i > 0) {
          // putaran ke-0 = pemanasan (JIT, inisialisasi OpenSSL), tidak dihitung
          enc.push(e);
          dec.push(d);
        }
      }

      const e = stats(enc);
      const d = stats(dec);
      const overhead = ciphertext.length + metaBytes(meta) - size.bytes;
      const row = {
        cipher: name,
        size: size.label,
        bytes: size.bytes,
        runs,
        encMedianMs: e.median,
        encSdMs: e.sd,
        decMedianMs: d.median,
        decSdMs: d.sd,
        encMBps: size.bytes / MB / (e.median / 1000),
        decMBps: size.bytes / MB / (d.median / 1000),
        overheadBytes: overhead,
        overheadPct: (overhead / size.bytes) * 100,
        integrity,
      };
      rows.push(row);
      console.log(
        `${name.padEnd(12)} ${size.label.padEnd(28)} enc ${row.encMBps.toFixed(1).padStart(7)} MB/s` +
          `  dec ${row.decMBps.toFixed(1).padStart(7)} MB/s  integritas ${integrity ? 'OK' : 'GAGAL'}`
      );
    }
  }
  return rows;
}

function runWorker(name, mode, file) {
  return new Promise((resolve, reject) => {
    const child = fork(path.join(__dirname, 'memory-worker.js'), [name, mode, file], {
      execArgv: ['--openssl-legacy-provider', '--expose-gc'],
    });
    child.once('message', resolve);
    child.once('error', reject);
    child.once('exit', (code) => code && reject(new Error(`worker ${name} keluar dengan kode ${code}`)));
  });
}

async function benchMemory() {
  // Data uji acak (bukan data pasien), dihapus setelah selesai.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fisiovault-bench-'));
  const file = path.join(dir, 'input.bin');
  const fd = fs.openSync(file, 'w');
  for (let written = 0; written < MEMORY_FILE_BYTES; written += MB) fs.writeSync(fd, crypto.randomBytes(MB));
  fs.closeSync(fd);

  const rows = [];
  try {
    const jobs = [
      ...Object.keys(CIPHERS).map((name) => ({ name, mode: 'stream' })),
      { name: 'AES-256-GCM', mode: 'buffer' },
    ];
    for (const { name, mode } of jobs) {
      const r = await runWorker(name, mode, file);
      const row = {
        cipher: name,
        mode: mode === 'stream' ? 'stream (dipakai aplikasi)' : 'buffer utuh (pembanding)',
        fileMB: MEMORY_FILE_BYTES / MB,
        encPeakMB: r.encPeakMB,
        decPeakMB: r.decPeakMB,
      };
      rows.push(row);
      console.log(
        `${name.padEnd(12)} ${row.mode.padEnd(26)} memori puncak enc ${r.encPeakMB.toFixed(1).padStart(7)} MB` +
          `  dec ${r.decPeakMB.toFixed(1).padStart(7)} MB`
      );
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  return rows;
}

function toCsv(rows) {
  const cols = Object.keys(rows[0]);
  const fmt = (v) => (typeof v === 'number' ? (Number.isInteger(v) ? v : v.toFixed(3)) : `"${v}"`);
  return [cols.join(','), ...rows.map((r) => cols.map((c) => fmt(r[c])).join(','))].join('\n') + '\n';
}

(async () => {
  const environment = {
    date: new Date().toISOString(),
    cpu: os.cpus()[0].model,
    cores: os.cpus().length,
    ramGB: +(os.totalmem() / 1024 ** 3).toFixed(1),
    os: `${os.type()} ${os.release()}`,
    node: process.version,
    openssl: process.versions.openssl,
    quick: QUICK,
  };
  console.log('Lingkungan:', environment, '\n\n== Kecepatan & integritas ==');
  const speed = await benchSpeed();
  console.log(`\n== Memori puncak (file ${MEMORY_FILE_BYTES / MB} MB) ==`);
  const memory = await benchMemory();

  const outDir = path.join(__dirname, 'results');
  fs.mkdirSync(outDir, { recursive: true });
  const suffix = QUICK ? '-quick' : '';
  fs.writeFileSync(path.join(outDir, `results${suffix}.json`), JSON.stringify({ environment, speed, memory }, null, 2));
  fs.writeFileSync(path.join(outDir, `speed${suffix}.csv`), toCsv(speed));
  fs.writeFileSync(path.join(outDir, `memory${suffix}.csv`), toCsv(memory));
  console.log(`\nHasil disimpan di ${path.relative(process.cwd(), outDir)}/`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
