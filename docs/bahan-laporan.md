# Bahan Laporan — FisioVault

Penyimpanan dokumen fisioterapi milik pasien dengan perbandingan AES, DES, dan RC4.

**Repositori kode:** https://github.com/rayyan129/fisiovault

> Dokumen ini adalah **bahan mentah** untuk laporan kelompok: alasan desain,
> hasil pengujian, dan hasil benchmark. Silakan disusun ulang sesuai format
> laporan dari dosen. Angka benchmark diambil dari `bench/results/results.json`.

---

## 1. Latar belakang singkat

Pasien fisioterapi sering pindah fasilitas kesehatan (faskes) dan harus membawa
dokumen terapi: data pribadi, scan KTP/BPJS, surat rujukan, hasil rontgen,
program latihan, dan video progres gerak. FisioVault memungkinkan pasien
menyimpan sendiri dokumen tersebut secara terenkripsi.

Setiap dokumen dienkripsi dengan **tiga algoritma sekaligus** (AES, DES, RC4)
supaya ketiganya dapat dibandingkan dari sisi kinerja dan keamanan pada data
yang sama.

## 2. Arsitektur

| Komponen | Teknologi | Peran |
|---|---|---|
| Server web | Node.js 24 + Express 5 | API register/login, upload, download |
| Database | SQLite (better-sqlite3) | User, sesi, metadata file (terenkripsi) |
| Kriptografi | Modul `crypto` Node (OpenSSL 3.5.6) | AES, DES, RC4, Argon2id via `argon2` |
| Penyimpanan file | Folder `storage/` di luar folder publik | Ciphertext saja, nama file = UUID |

### Alur upload

```
Browser ──multipart──▶ busboy (stream, tanpa file sementara)
                          │
                          ├─▶ SHA-256 (untuk verifikasi saat download)
                          ├─▶ AES-256-GCM ─▶ storage/<uuid>.aes
                          ├─▶ DES-CBC     ─▶ storage/<uuid>.des
                          └─▶ RC4         ─▶ storage/<uuid>.rc4

Kunci per file (AES 256-bit, DES 64-bit, RC4 128-bit) dibungkus master key
──▶ disimpan di DB bersama IV, auth tag, dan metadata terenkripsi.
```

### Alur download

```
storage/<uuid>.<algo> ─▶ dekripsi (stream) ─▶ verifikasi SHA-256 ─▶ Browser
                                              (chunk terakhir ditahan
                                               sampai hash cocok)
```

### Endpoint API

| Method | Path | Fungsi |
|---|---|---|
| POST | `/auth/register` | Daftar akun (username + password) |
| POST | `/auth/login` | Login, set cookie sesi |
| POST | `/auth/logout` | Hapus sesi |
| GET | `/auth/me` | Info user yang sedang login |
| POST | `/files` | Upload file (JPG, PNG, PDF, DOCX, MP4; maks. 1 GB) |
| POST | `/files/form` | Simpan data pribadi (nama, tgl lahir, HP, alamat, BPJS, diagnosis) |
| GET | `/files` | Daftar file milik sendiri |
| GET | `/files/:id/download?algo=aes\|des\|rc4` | Unduh dan dekripsi dengan algoritma pilihan |
| DELETE | `/files/:id` | Hapus file (DB + ketiga ciphertext) |

## 3. Desain kriptografi dan alasannya

### 3.1 Parameter ketiga cipher

| | AES-256-GCM | DES-CBC | RC4 |
|---|---|---|---|
| Jenis | Block cipher, mode AEAD | Block cipher, mode CBC | Stream cipher |
| Ukuran kunci | 256 bit | 64 bit (efektif 56 bit) | 128 bit |
| Ukuran blok | 128 bit | 64 bit | — |
| IV / nonce | 12 byte acak per file | 8 byte acak per file | Tidak ada (kunci acak per file) |
| Padding | Tidak perlu | PKCS#7 | Tidak perlu |
| Autentikasi/integritas | Ya (auth tag 16 byte) | Tidak | Tidak |
| Status saat ini | Standar (NIST SP 800-38D) | Ditarik NIST (FIPS 46-3, 2005) | Dilarang di TLS (RFC 7465, 2015) |

**Alasan pemilihan parameter:**

- **AES-256-GCM.** GCM memberi kerahasiaan sekaligus integritas (AEAD), jadi
  perubahan 1 bit pada ciphertext langsung terdeteksi. IV 12 byte adalah
  panjang yang direkomendasikan NIST; IV dibuat di dalam fungsi `encrypt()`
  sehingga pemanggil tidak mungkin memakai ulang IV (pemakaian ulang IV pada GCM
  membocorkan plaintext dan memungkinkan pemalsuan tag).
- **DES-CBC.** Mode CBC dipilih karena **ECB dilarang**: ECB mengenkripsi blok
  yang sama menjadi ciphertext yang sama sehingga pola data (misalnya pada
  gambar KTP) tetap terlihat. IV acak per file mencegah file berawalan sama
  menghasilkan ciphertext berawalan sama. Padding PKCS#7 ditangani OpenSSL,
  bukan kode sendiri.
- **RC4.** Karena RC4 tidak punya IV, satu-satunya cara mendapatkan keystream
  unik adalah **kunci acak baru per file**. Tidak memakai RC4-drop[n] supaya
  yang diuji adalah RC4 standar.

### 3.2 Satu implementasi kriptografi (OpenSSL) untuk ketiga cipher

Ketiga cipher dijalankan lewat modul `crypto` Node yang memakai OpenSSL 3.5.6.
Pada OpenSSL 3, DES dan RC4 dipindah ke *legacy provider* yang tidak aktif
secara default, sehingga aplikasi dijalankan dengan flag
`--openssl-legacy-provider`.

Alternatif yang ditolak: memakai library JavaScript murni (misalnya crypto-js)
untuk DES/RC4. Alasannya, benchmark menjadi tidak adil karena AES berjalan di
kode C dengan akselerasi hardware, sedangkan DES/RC4 di JavaScript. Penandaan
"legacy" oleh OpenSSL sendiri juga mendukung kesimpulan bahwa kedua algoritma
tersebut tidak layak untuk data sensitif.

### 3.3 Manajemen kunci: envelope encryption

- Setiap file mendapat **kunci data acak sendiri** untuk masing-masing cipher.
- Kunci data **dibungkus** (dienkripsi) dengan master key AES-256-GCM yang
  disimpan di file `.env` (tidak masuk repo), lalu hanya versi terbungkus yang
  disimpan di DB.
- Saat membungkus, ID file dan nama algoritma dipakai sebagai **AAD**
  (*additional authenticated data*). Akibatnya, kunci milik satu file tidak
  bisa ditempel ke baris file lain (terbukti di tes).

**Alasan** dibanding kunci yang diturunkan dari password pengguna: ganti atau
lupa password tidak membuat file hilang; server tidak perlu menyimpan password
atau kunci turunan selama sesi; pola ini sama dengan yang dipakai layanan KMS
(AWS KMS, Google Cloud KMS).

**Kelemahan:** pihak yang menguasai server *dan* file `.env` sekaligus dapat
membuka semua file. Mitigasi di produksi: master key disimpan di HSM/KMS.

### 3.4 Tidak ada plaintext sensitif di DB, log, atau disk

| Lokasi | Yang disimpan |
|---|---|
| `storage/` | Hanya ciphertext; nama file = UUID acak |
| DB tabel `files` | Kunci terbungkus, IV, auth tag, ukuran, dan `meta` terenkripsi (nama file asli, MIME, SHA-256 plaintext) |
| DB tabel `users` | Username + hash Argon2id (bukan password) |
| DB tabel `sessions` | SHA-256 dari token sesi (bukan token aslinya) |
| File sementara | Tidak ada: upload di-stream langsung ke cipher |
| Log | Hanya pesan error, tidak berisi isi data |

Hash SHA-256 plaintext sengaja ikut dienkripsi. Untuk data berentropi rendah
seperti form data pribadi, hash yang terbuka dapat ditebak dengan mencoba
kombinasi nama dan tanggal lahir.

### 3.5 Integritas saat download

Saat download, server menghitung SHA-256 hasil dekripsi dan **menahan chunk
terakhir** sampai hash (dan tag GCM untuk AES) terbukti cocok. Kalau tidak
cocok, koneksi diputus sehingga pengguna tidak pernah menerima file rusak secara
utuh.

Dengan begitu DES dan RC4 juga mendapat cek integritas, tetapi **di level
aplikasi**, bukan dari cipher-nya. Perbedaan ini terlihat di log pengujian:

```
aes : Unsupported state or unable to authenticate data   ← ditolak oleh GCM
des : Integritas gagal: SHA-256 hasil dekripsi tidak cocok ← ditolak oleh aplikasi
rc4 : Integritas gagal: SHA-256 hasil dekripsi tidak cocok ← ditolak oleh aplikasi
```

### 3.6 Stream untuk file besar

Semua cipher menerima input/output berupa stream (potongan 64 KB), sehingga
video ratusan MB tidak pernah dimuat utuh ke memori. Benchmark memori
(bagian 6.3) menunjukkan bukti angkanya.

## 4. Keamanan aplikasi (di luar cipher)

| Ancaman | Mitigasi |
|---|---|
| Password bocor dari DB | Argon2id (memory-hard, 64 MB/hash), rekomendasi OWASP |
| Brute-force via hashing panjang | Password dibatasi 8–128 karakter |
| Token sesi bocor dari DB | Hanya SHA-256 token yang disimpan |
| Pencurian cookie via XSS | Cookie `HttpOnly` |
| CSRF | Cookie `SameSite=Lax` |
| Penyadapan | Cookie `Secure` saat produksi (HTTPS) |
| Session fixation | Token baru setiap login |
| User enumeration | Pesan dan waktu respons login sama untuk username salah/password salah |
| IDOR (akses file orang lain) | Middleware `requireFileOwner`; file orang lain dijawab 404 (bukan 403) |
| Upload file berbahaya | Allowlist ekstensi (JPG/PNG/PDF/DOCX/MP4), MIME ditentukan server, batas 1 GB |
| Konten dieksekusi browser | `Content-Disposition: attachment`, `X-Content-Type-Options: nosniff` |
| File sensitif tersimpan di cache | `Cache-Control: no-store` |
| Data minimization | Akun memakai username, bukan email/identitas pribadi |

## 5. Pengujian fungsional

Dijalankan dengan `npm test` (Node test runner). **35 tes, semuanya lulus.**

| Kelompok | Jumlah | Yang dibuktikan |
|---|---|---|
| AES-256-GCM | 5 | Round-trip 5 MB identik (SHA-256), file kosong, IV unik, **ciphertext diubah 1 bit ditolak**, kunci salah ditolak |
| DES-CBC | 5 | Round-trip identik, ukuran padding PKCS#7 benar, IV unik, kunci salah tidak membocorkan plaintext, **ciphertext diubah TIDAK terdeteksi** |
| RC4 | 6 | Round-trip identik, file kosong, kunci unik per file, kunci salah tidak error (hanya sampah), **malleability** ("2x/minggu" diubah jadi "9x/minggu" tanpa kunci), **kunci dipakai ulang: C₁⊕C₂ = P₁⊕P₂** |
| Auth | 9 | Hash Argon2id, username unik, validasi input, pesan login seragam, cookie HttpOnly/SameSite, token tidak tersimpan mentah, logout, sesi kedaluwarsa, kepemilikan file |
| Upload/download | 10 | Enkripsi 3x, tidak ada plaintext di storage/DB, download 3 cipher identik, isolasi antar-user, tipe file ditolak, tamper terdeteksi di ketiga cipher, form data pribadi, kunci tertukar ditolak, hapus file |

Tiga tes cipher yang paling penting untuk laporan:

1. **Integritas:** perubahan 1 bit ciphertext → AES menolak, DES dan RC4 menerima
   diam-diam dengan isi yang rusak.
2. **Malleability RC4:** penyerang dapat mengubah isi secara terarah tanpa tahu
   kunci, cukup meng-XOR byte ciphertext.
3. **Pemakaian ulang kunci RC4:** jika dua file memakai kunci yang sama,
   C₁ ⊕ C₂ = P₁ ⊕ P₂; mengetahui isi satu file langsung membuka file lain.
   Ini alasan aturan "kunci acak per file".

## 6. Benchmark

### 6.1 Metodologi

- Dijalankan dengan `npm run bench`; kode di `bench/`.
- Memakai **modul enkripsi yang sama dengan aplikasi** (`src/crypto/*`).
- Data uji: byte acak (bukan data pasien), ukuran mewakili jenis dokumen.
- Input di-stream dalam potongan 64 KB, output dibuang (supaya disk tidak ikut
  terukur).
- Setiap ukuran diulang 5–200 kali (file kecil lebih sering); 1 putaran
  pemanasan tidak dihitung; yang dilaporkan **median**.
- Memori puncak (RSS) diukur di **child process terpisah per cipher** pada file
  256 MB, dibandingkan dengan cara naif (membaca file utuh ke memori).
- Integritas: SHA-256 hasil dekripsi dibandingkan dengan plaintext asli.

**Lingkungan:** Intel Core i7-12700H (20 thread), RAM 15,7 GB, Windows 11
(10.0.26200), Node.js v24.16.0, OpenSSL 3.5.6.

### 6.2 Waktu dan throughput

Waktu enkripsi / dekripsi (median, ms):

| Ukuran | AES-256-GCM | DES-CBC | RC4 |
|---|---|---|---|
| 1 KB (form data pribadi) | 0,17 / 0,16 | 0,14 / 0,13 | 0,09 / 0,09 |
| 100 KB (scan KTP/BPJS) | 0,20 / 0,19 | 1,90 / 1,68 | 0,52 / 0,52 |
| 1 MB (PDF rujukan) | 1,11 / 1,13 | 17,15 / 15,19 | 4,13 / 4,07 |
| 10 MB (rontgen/DOCX) | 13,31 / 10,68 | 513,02 / 405,44 | 51,05 / 53,06 |
| 100 MB (video latihan) | 366,63 / 338,81 | 4925,12 / 5077,52 | 513,01 / 910,98 |

Throughput enkripsi / dekripsi (MB/s):

| Ukuran | AES-256-GCM | DES-CBC | RC4 |
|---|---|---|---|
| 1 KB | 5,7 / 6,2 | 7,1 / 7,6 | 11,3 / 11,3 |
| 100 KB | 479,2 / 512,9 | 51,3 / 58,1 | 189,2 / 189,1 |
| 1 MB | 900,8 / 887,3 | 58,3 / 65,8 | 242,4 / 245,6 |
| 10 MB | 751,2 / 936,2 | 19,5 / 24,7 | 195,9 / 188,5 |
| 100 MB | 272,8 / 295,2 | 20,3 / 19,7 | 194,9 / 109,8 |

### 6.3 Memori puncak (file 256 MB)

| Cipher | Cara | Enkripsi (MB) | Dekripsi (MB) |
|---|---|---|---|
| AES-256-GCM | stream (dipakai aplikasi) | 33,6 | 18,5 |
| DES-CBC | stream (dipakai aplikasi) | 33,7 | 34,9 |
| RC4 | stream (dipakai aplikasi) | 34,4 | 36,9 |
| AES-256-GCM | buffer utuh (pembanding) | 768,1 | 512,0 |

### 6.4 Overhead ukuran

| Cipher | Overhead per file | Komponen |
|---|---|---|
| AES-256-GCM | 28 byte | IV 12 + auth tag 16 |
| DES-CBC | 9–16 byte | IV 8 + padding 1–8 (16 byte pada ukuran uji yang kelipatan 8) |
| RC4 | 0 byte | — |

Untuk file ≥ 100 KB, overhead semua cipher < 0,03%.

### 6.5 Integritas

Round-trip ketiga cipher pada kelima ukuran: **SHA-256 identik (15/15 OK).**

### 6.6 Analisis

1. **AES-256-GCM paling cepat** untuk file ≥ 100 KB: sekitar 15× lebih cepat
   dari DES dan 3–4× lebih cepat dari RC4 pada ukuran 1 MB. Penyebabnya CPU
   modern punya instruksi khusus **AES-NI** (dan PCLMULQDQ untuk GHASH di GCM),
   sedangkan DES dan RC4 dihitung dengan instruksi umum. Anggapan bahwa cipher
   lama lebih "ringan" tidak berlaku di perangkat keras sekarang.
2. **DES paling lambat** karena 16 ronde Feistel per blok yang hanya 64 bit,
   ditambah mode CBC yang enkripsinya tidak bisa diparalelkan.
3. **Pada 1 KB urutannya terbalik** (RC4 > DES > AES), tetapi semua di bawah
   0,2 ms. Pada ukuran sekecil ini waktu didominasi biaya membuat stream dan
   inisialisasi cipher, bukan algoritmanya; key schedule RC4 dan DES lebih
   murah daripada setup AES-GCM. Baris ini tidak bisa dipakai untuk menarik
   kesimpulan kecepatan algoritma.
4. **Stream membuat memori konstan** (~34 MB) berapa pun ukuran file, sedangkan
   membaca file utuh membutuhkan ~3× ukuran file (768 MB untuk file 256 MB).
   Untuk video ratusan MB dengan banyak pengguna bersamaan, cara buffer tidak
   layak.
5. **Overhead ukuran tidak menjadi pembeda**; yang membedakan adalah keamanan
   dan kecepatan.

### 6.7 Catatan validitas (wajib disebut)

Simpangan baku pada ukuran 10–100 MB cukup besar (misalnya DES 10 MB:
513 ± 163 ms), dan run cepat sebelumnya memberi DES 10 MB ≈ 55 MB/s.
Kemungkinan penyebabnya adalah *CPU throttling* laptop (mode daya/suhu) dan
proses lain yang berjalan; prosesor i7-12700H juga punya inti P dan E yang
kecepatannya berbeda. **Sebelum angka final dipakai:** colokkan charger, set
mode daya ke *Best performance*, tutup aplikasi lain, jalankan `npm run bench`
2–3 kali, dan pakai run dengan simpangan baku terkecil (atau rata-rata median
antar-run).

## 7. Perbandingan keamanan

| Aspek | AES-256-GCM | DES-CBC | RC4 |
|---|---|---|---|
| Brute-force kunci | 2²⁵⁶ — tidak mungkin | 2⁵⁶ — sudah dipecahkan (EFF *Deep Crack*, 1998, < 3 hari) | 2¹²⁸ — kuat secara ukuran kunci |
| Kelemahan struktural utama | Tidak ada yang praktis (asal IV tidak dipakai ulang) | Blok 64 bit → serangan birthday **Sweet32** setelah ±32 GB data dengan satu kunci | Bias keystream (byte awal) → serangan pada WEP dan RC4 di TLS |
| Integritas bawaan | Ya (auth tag) | Tidak; CBC juga rentan *padding oracle* jika error padding terlihat | Tidak; **malleable** bit per bit |
| Risiko salah pakai | IV dipakai ulang → fatal | IV tebak-able → bocor pola | Kunci dipakai ulang → C₁⊕C₂ = P₁⊕P₂ |
| Rekomendasi | **Dipakai** | Tidak untuk data baru | Tidak untuk data baru |

## 8. Kesimpulan

1. **AES-256-GCM unggul di semua aspek yang diukur**: paling aman (kunci
   256 bit, integritas bawaan) dan sekaligus paling cepat untuk dokumen ≥ 100 KB
   berkat akselerasi hardware.
2. **DES tidak layak** untuk data kesehatan: kunci 56 bit dapat di-brute-force,
   blok 64 bit rentan Sweet32, dan paling lambat (±20–60 MB/s).
3. **RC4 lebih cepat dari DES** tetapi tidak punya integritas, malleable, dan
   keystream-nya bias; kesalahan memakai ulang kunci langsung membocorkan data.
4. Untuk penggunaan nyata, FisioVault seharusnya **hanya memakai AES-256-GCM**.
   DES dan RC4 di aplikasi ini hanya untuk keperluan perbandingan.
5. Desain stream membuat memori tetap rendah (~34 MB) bahkan untuk file
   ratusan MB, sesuai kebutuhan video latihan.

## 9. Keterbatasan dan pengembangan lanjutan

- Antarmuka web masih sederhana (HTML + JavaScript tanpa framework) dan belum
  diuji otomatis; pengujian otomatis baru mencakup API.
- Belum ada *rate limiting* login (brute-force online masih mungkin).
- Master key di `.env`; di produksi sebaiknya di HSM/KMS dengan rotasi kunci.
- Validasi file hanya dari ekstensi, belum memeriksa *magic bytes*.
- Integritas GCM per file diperiksa di akhir stream; untuk video sangat besar
  bisa dipakai format *chunked AEAD* (tag per potongan) agar kerusakan
  terdeteksi lebih awal.
- Benchmark di satu mesin (laptop); hasil di server/ARM bisa berbeda.
- Belum ada fitur berbagi file ke faskes (misalnya tautan sementara).

## 10. Referensi

1. NIST SP 800-38D — *Recommendation for Block Cipher Modes of Operation: Galois/Counter Mode (GCM) and GMAC*, 2007.
2. NIST FIPS 197 — *Advanced Encryption Standard (AES)*, 2001 (diperbarui 2023).
3. NIST FIPS 46-3 — *Data Encryption Standard (DES)*, ditarik tahun 2005.
4. NIST SP 800-38A — *Recommendation for Block Cipher Modes of Operation* (CBC, ECB, dll.), 2001.
5. RFC 7465 — *Prohibiting RC4 Cipher Suites*, IETF, 2015.
6. K. Bhargavan & G. Leurent, *On the Practical (In-)Security of 64-bit Block Ciphers* (Sweet32), ACM CCS 2016.
7. N. AlFardan dkk., *On the Security of RC4 in TLS*, USENIX Security 2013.
8. Electronic Frontier Foundation, *Cracking DES*, O'Reilly, 1998.
9. RFC 9106 — *Argon2 Memory-Hard Function for Password Hashing*, IETF, 2021.
10. OWASP — *Password Storage Cheat Sheet* dan *Session Management Cheat Sheet*.
11. OpenSSL 3 — *Migration guide: Legacy provider*.
