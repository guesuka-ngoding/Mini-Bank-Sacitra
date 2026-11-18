const bcrypt = require('bcryptjs'), pg = require('pg');
const { ADMIN_USER: u = 'admin', ADMIN_PASSWORD: p, ADMIN_PIN: n } = process.env;
if (!p || p.length < 10 || !/^\d{6}$/.test(n || '')) { console.error('Set ADMIN_PASSWORD (min 10 karakter) dan ADMIN_PIN (6 digit)'); process.exit(1); }
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
pool.query(`insert into users(username,name,role,status,pass_hash,pin_hash) values($1,'Administrator','admin','active',$2,$3) on conflict(username) do nothing`,
  [u, bcrypt.hashSync(p, 12), bcrypt.hashSync(n, 12)])
  .then(r => console.log(r.rowCount ? 'Admin dibuat' : 'Admin sudah ada')).catch(e => console.error(e.message)).finally(() => pool.end());
