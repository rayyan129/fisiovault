# FisioVault

Aplikasi web tempat pasien fisioterapi menyimpan sendiri dokumen terapinya
(data pribadi, scan KTP/BPJS, rujukan, rontgen, program latihan, video) secara
terenkripsi. Setiap dokumen dienkripsi dengan **AES-256-GCM, DES-CBC, dan RC4**
untuk dibandingkan kinerja dan keamanannya.

Tugas kelompok mata kuliah Kriptografi, Institut Teknologi Sepuluh Nopember.

| Nama | NRP |
|---|---|
| Rayyan Muhtar Ali | 5054251051 |
| Muhammad Farid Wijdan | 5054251042 |

## Laporan

- [Laporan (PDF)](docs/Laporan-FisioVault.pdf)
- [Laporan (Word)](docs/Laporan-FisioVault.docx)
- [Bahan laporan (Markdown)](docs/bahan-laporan.md)

## Riwayat percakapan dengan asisten AI

Proyek ini dikerjakan dengan bantuan asisten AI. Riwayat percakapannya:

- [Log percakapan dengan Claude Code](docs/percakapan-claude-code.md) (transkrip pengerjaan kode dan laporan di repo ini)
- [Percakapan ChatGPT](https://chatgpt.com/share/6adf7731-ad74-83ec-a639-1f1e0ea17cc7?ogimg=plain)
- [Percakapan Claude (claude.ai)](https://claude.ai/share/b238a9c7-c48e-433f-8a2a-21ffb23a5d5a)

## Cara menjalankan

Butuh Node.js 22.9 atau lebih baru (disarankan v24 LTS).

```powershell
npm install
Copy-Item .env.example .env
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# tempel hasilnya ke FISIOVAULT_MASTER_KEY di file .env
npm start
```

Buka http://localhost:3000.

| Perintah | Fungsi |
|---|---|
| `npm start` | Menjalankan aplikasi |
| `npm test` | Menjalankan 35 tes otomatis |
| `npm run bench` | Menjalankan benchmark (hasil di `bench/results/`) |

## Struktur

| Folder | Isi |
|---|---|
| `src/crypto/` | AES-256-GCM, DES-CBC, RC4, dan pembungkus kunci (envelope encryption) |
| `src/routes/`, `src/middleware/`, `src/auth/` | Registrasi/login, sesi, unggah/unduh, cek kepemilikan file |
| `src/services/vault.js` | Enkripsi 3 algoritma sekaligus dan verifikasi integritas |
| `public/` | Antarmuka web |
| `test/` | Tes otomatis |
| `bench/` | Skrip dan hasil benchmark |
| `docs/` | Laporan dan log percakapan |
