# Catatan perbaikan Mini Bank

## Penyebab tidak bisa connect
1. `public/app.js` & `public/index.html` ditempeli kode Supabase client (URL `https://supabase.co` tidak valid,
   `esm.sh`/`unpkg` tanpa nama paket, dimuat 2x, dan `register` di-assign ulang ke `const`). Aplikasi ini
   memang TIDAK memakai REST/anon key: browser -> `/api/*` -> Express -> Postgres (`pg`) dengan role `app_server`.
   `supabase.sql` sengaja mencabut akses anon/authenticated. -> Kode itu dihapus (versi asli dipulihkan).
2. `local.js` berisi `import ... import.meta.env` di file CommonJS -> SyntaxError. -> Dipulihkan.
3. `.env`: project-ref salah, host pooler beda region, baris diawali spasi, `SUPABASE_URL` tidak valid.
4. `supabase.sql`: role `app_server` hanya diberi password saat PERTAMA dibuat; menjalankan ulang tidak mengubahnya.
   -> sekarang `alter role ... password` selalu dijalankan (1 tempat).

## Bug lain yang diperbaiki
- `api/index.js`: hasil `SUM()` (tipe numeric) dikembalikan `pg` sebagai STRING -> limit harian salah hitung
  ("0"+1000="01000"), kas teller & total saldo salah. Ditambah parser numeric -> Number.
- Kolom foto base64 tidak lagi ditarik di setiap request/daftar user (lebih cepat).
- Backup tidak lagi memuat hash password/PIN.
- Pesan error jelas bila `DATABASE_URL` kosong; `pool.on('error')` agar proses tidak crash.
- Frontend: "Total Saldo Tersimpan" (script via innerHTML tidak jalan), foto gagal dibaca tidak menggantung, struk di-escape.
- `.gitignore` dirapikan (sebelumnya duplikat & CRLF, `.env*` ikut mengabaikan `.env.example`).
- Ditambah `npm run check-db` untuk mendiagnosis koneksi.

## Langkah pakai
1. Supabase > SQL Editor: ganti `GANTI_DENGAN_PASSWORD_ACAK_PANJANG` di `supabase.sql`, lalu Run.
2. Isi `.env` (DATABASE_URL dari Connect > Transaction pooler; user `app_server.dnlxfjxvitauvseyvmex`).
3. `npm install` -> `npm run check-db` -> `npm run seed` -> `npm run dev` (http://localhost:3000)
4. Vercel: isi env `DATABASE_URL` & `JWT_SECRET`, lalu deploy.
