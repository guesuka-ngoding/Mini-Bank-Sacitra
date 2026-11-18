// Cek koneksi database:  npm run check-db
// Memakai pengaturan yang sama persis dengan api/index.js, lalu memberi diagnosis dalam bahasa Indonesia.
const pg = require('pg');
const url = process.env.DATABASE_URL;
const fail = (m) => { console.error('\n✖ ' + m + '\n'); process.exit(1); };

if (!url) fail('DATABASE_URL kosong. Salin .env.example menjadi .env lalu isi (pastikan baris TIDAK diawali spasi).');
let u;
try { u = new URL(url); } catch { fail('DATABASE_URL bukan URL yang valid. Jika password punya karakter khusus (@ # / ? :), ubah jadi URL-encoded.'); }

const ref = (decodeURIComponent(u.username).split('.')[1] || '');
console.log('Host     :', u.hostname + ':' + u.port);
console.log('User     :', decodeURIComponent(u.username));
console.log('Project  :', ref || '(tidak ada — username harus app_server.<project-ref>)');
if (!/pooler\.supabase\.com$/.test(u.hostname)) console.log('⚠ Host bukan pooler Supabase. Pakai "Transaction pooler" dari tombol Connect di dashboard.');
if (u.port !== '6543') console.log('⚠ Port bukan 6543 (Transaction pooler), yang disarankan untuk Vercel.');
if (decodeURIComponent(u.username).split('.')[0] !== 'app_server') console.log('⚠ Username bukan app_server. Aplikasi ini dirancang memakai role app_server dari supabase.sql.');
if (process.env.SUPABASE_URL && ref && !process.env.SUPABASE_URL.includes(ref)) console.log('⚠ SUPABASE_URL tidak cocok dengan project di DATABASE_URL (aplikasi ini tidak memakai SUPABASE_URL, boleh dihapus).');

const pool = new pg.Pool({ connectionString: url, ssl: { rejectUnauthorized: false }, max: 1, connectionTimeoutMillis: 8000 });
(async () => {
  try {
    const t = (await pool.query('select now() n, current_user cu')).rows[0];
    console.log('\n✔ Terhubung sebagai', t.cu, '— waktu server:', t.n.toISOString());
    const need = ['products', 'users', 'accounts', 'tx', 'logs', 'cash', 'rate_limit'];
    const have = (await pool.query("select table_name from information_schema.tables where table_schema='public'")).rows.map(r => r.table_name);
    const miss = need.filter(x => !have.includes(x));
    if (miss.length) fail('Koneksi OK, tapi tabel belum ada: ' + miss.join(', ') + '. Jalankan supabase.sql di SQL Editor.');
    const n = (await pool.query('select count(*)::int c from users')).rows[0].c;
    console.log('✔ Semua tabel ada. Jumlah user:', n, n ? '' : '(kosong → jalankan: npm run seed)');
  } catch (e) {
    const m = e.message || String(e);
    let hint = '';
    if (/Tenant or user not found/i.test(m)) hint = 'Project-ref di username salah ATAU region pada host pooler tidak sama dengan region project. Salin ulang string dari Connect → Transaction pooler.';
    else if (/password authentication failed/i.test(m)) hint = 'Password app_server salah / role belum dibuat. Jalankan supabase.sql (baris "alter role app_server ... password") lalu samakan password di .env.';
    else if (/ENOTFOUND|EAI_AGAIN/i.test(m)) hint = 'Host tidak ditemukan. Periksa penulisan host pooler atau koneksi internet.';
    else if (/ETIMEDOUT|timeout/i.test(m)) hint = 'Timeout. Cek internet/firewall, dan pastikan memakai port 6543 (bukan 5432 direct yang butuh IPv6).';
    else if (/permission denied/i.test(m)) hint = 'Role belum punya hak akses. Jalankan ulang bagian GRANT di supabase.sql.';
    fail('Gagal: ' + m + (hint ? '\n  → ' + hint : ''));
  } finally { pool.end(); }
})();
