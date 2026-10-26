# FisioVault — konteks project

Tugas kelompok (4 orang) mata kuliah Keamanan Informasi, ITS.
Aplikasi web tempat **pasien fisioterapi** menyimpan sendiri dokumen terapinya
supaya bisa dibawa saat pindah faskes. Setiap data disimpan terenkripsi dengan
**AES, DES, dan RC4** (ketiganya, untuk dibandingkan).

## Jenis data yang harus didukung
- Data pribadi (form): nama, tanggal lahir, no. HP, alamat, no. BPJS, diagnosis
- Scan identitas: foto KTP, kartu BPJS (JPG/PNG)
- Dokumen kantor: surat rujukan, hasil rontgen (PDF), program latihan (DOCX)
- Video: rekaman latihan/progres gerak (MP4, bisa ratusan MB)

## Stack
- Node.js + Express
- SQLite (better-sqlite3) untuk user & metadata file
- Modul `crypto` bawaan Node untuk ketiga cipher (backend OpenSSL yang sama,
  supaya benchmark adil)
- File terenkripsi disimpan di folder `storage/` (di luar folder publik)
- Password di-hash (bcrypt/argon2), sesi via cookie

## Aturan kriptografi (wajib)
- AES: AES-256-GCM (IV 12 byte acak per file, simpan auth tag)
- DES: DES-CBC (IV 8 byte acak per file, padding PKCS#7)
- RC4: stream cipher, kunci acak per file (jangan pernah pakai ulang kunci)
- **ECB dilarang.**
- Tidak boleh ada plaintext data sensitif di DB, log, folder publik, atau file sementara.
- Node 17+ (OpenSSL 3) memindahkan DES dan RC4 ke *legacy provider*.
  Kalau muncul error "unsupported", jangan ganti diam-diam ke library lain:
  jelaskan pilihannya ke saya dulu.
- File besar (video) dienkripsi dengan stream, bukan dibaca utuh ke memori.

## Cara bekerja dengan saya
- Saya sedang belajar. Kerjakan **satu langkah kecil per kali**, lalu berhenti.
- Untuk setiap fungsi/file baru, jelaskan singkat: fungsinya untuk apa,
  masuk tahap mana di alur aplikasi, dan langkah berikutnya apa.
- Jangan buat semua fitur sekaligus.
- Usulkan pesan commit yang bermakna setelah tiap langkah,
  tapi **jangan commit/push sendiri**: saya yang commit dari akun GitHub saya.
- Kalau ada keputusan desain (mode, kunci, penyimpanan), sebutkan alasannya
  karena alasan itu dipakai di laporan.

## Urutan pengerjaan
1. Setup project + struktur folder
2. `src/crypto/` — encrypt/decrypt AES, DES, RC4 + tes round-trip (hasil harus identik, cek SHA-256)
3. Register/login + middleware cek kepemilikan file
4. Upload → enkripsi 3x → simpan; download → dekripsi → file utuh
5. Benchmark (waktu enkripsi/dekripsi, throughput, memori, overhead ukuran, integritas)
6. Bahan laporan
