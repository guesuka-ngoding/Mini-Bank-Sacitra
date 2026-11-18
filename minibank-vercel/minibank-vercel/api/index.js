// Ganti isi server.js lama dengan file ini. Frontend (html/css/app.js) TIDAK perlu diubah.
const express = require('express'), pg = require('pg'), bcrypt = require('bcryptjs'), jwt = require('jsonwebtoken');
pg.types.setTypeParser(20, Number);   // bigint -> number
pg.types.setTypeParser(1700, Number); // numeric (hasil SUM) -> number, tanpa ini 'used + amount' jadi penggabungan string
const SECRET = process.env.JWT_SECRET;
if (!SECRET || SECRET.length < 32) throw new Error('JWT_SECRET wajib diisi (min 32 karakter)');
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL belum diisi (lihat .env.example)');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 3, idleTimeoutMillis: 10000, connectionTimeoutMillis: 8000 });
pool.on('error', e => console.error('pg pool error:', e.message));
const Q = (s, p) => pool.query(s, p).then(r => r.rows);
const Q1 = (s, p) => Q(s, p).then(r => r[0]);
const UCOLS = 'id,username,name,role,status,wa,nik,pass_hash,pin_hash,fail_count,pin_fail,locked_until,created,(id_photo is not null) has_photo';

// Rate limit berbasis database: berlaku lintas instance serverless Vercel
const limit = (name, max, secs) => async (q, s, n) => {
  try {
    const ip = (q.headers['x-vercel-forwarded-for'] || q.headers['x-forwarded-for'] || q.ip || '').split(',')[0].trim();
    const r = await Q1(`insert into rate_limit(key,hits,reset_at) values($1,1,now()+make_interval(secs=>$2)) on conflict(key) do update set
      hits=case when rate_limit.reset_at<now() then 1 else rate_limit.hits+1 end,
      reset_at=case when rate_limit.reset_at<now() then now()+make_interval(secs=>$2) else rate_limit.reset_at end returning hits`, [name + ':' + ip, secs]);
    if (r.hits > max) return s.status(429).json({ error: 'Terlalu banyak permintaan, coba lagi sebentar lagi' });
    n();
  } catch (e) { console.error(e); s.status(500).json({ error: 'Server error' }); }
};
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '1mb' }));
app.use('/api', limit('api', 300, 60));
app.use(express.static('public'));

const h = f => async (q, s) => { try { const r = await f(q, s); s.json(r === undefined ? { ok: 1 } : r); } catch (e) { s.status(typeof e === 'string' ? 400 : 500).json({ error: typeof e === 'string' ? e : 'Server error' }); if (typeof e !== 'string') console.error(e); } };
const auth = (...roles) => async (q, s, n) => {
  try {
    const t = ((q.headers.cookie || '').match(/(?:^|; )mb=([^;]+)/) || [])[1];
    const u = await Q1(`select ${UCOLS} from users where id=$1`, [jwt.verify(t, SECRET).id]);
    if (!u || u.status !== 'active' || (roles.length && !roles.includes(u.role))) throw 0;
    q.u = u; n();
  } catch { s.status(401).json({ error: 'Tidak diizinkan' }); }
};
const log = (q, a, d = '') => Q('insert into logs(username,action,detail) values($1,$2,$3)', [q.u ? q.u.username : '-', a, d]);
const pub = u => ({ id: u.id, username: u.username, name: u.name, role: u.role, status: u.status, wa: u.wa, nik: u.nik, created: u.created, hasPhoto: !!u.has_photo });
const mapTx = t => ({ id: t.id, date: t.date, type: t.type, from: t.from_no, to: t.to_no, amount: t.amount, by: t.by_user, balAfter: t.bal_after });
const mapAcc = a => a && { no: a.no, userId: a.user_id, productId: a.product_id, balance: a.balance };
const chk = async b => {
  if (!b.name || !b.username || !/^\d{6}$/.test(b.pin || '') || (b.password || '').length < 8) throw 'Data tidak lengkap (password min 8, PIN 6 digit)';
  if (await Q1('select 1 from users where username=$1', [b.username])) throw 'Username sudah dipakai';
};
const newAccount = async (userId, productId = 1) => {
  const r = await Q1(`insert into accounts(no,user_id,product_id) values('10'||lpad(((select coalesce(max(substr(no,3)::int),0) from accounts)+1)::text,8,'0'),$1,$2) returning *`, [userId, +productId]);
  return r;
};


async function doTx(type, from, to, amount, by, pin) {
  amount = Math.floor(+amount);
  if (!(amount > 0)) throw 'Nominal tidak valid';
  if (from && from === to) throw 'Rekening sama';
  const c = await pool.connect();
  try {
    await c.query('begin');
    const nos = [from, to].filter(Boolean).sort();
    const rows = (await c.query('select a.*,u.status,u.pin_hash,u.pin_fail from accounts a join users u on u.id=a.user_id where a.no=any($1) order by a.no for update of a', [nos])).rows;
    const A = rows.find(r => r.no === from), B = rows.find(r => r.no === to);
    if ((from && !A) || (to && !B)) throw 'Rekening tidak ditemukan';
    if ([A, B].some(x => x && x.status !== 'active')) throw 'Rekening nonaktif';
    if (A) {
      if (A.pin_fail >= 5) throw 'PIN diblokir karena salah 5 kali. Hubungi admin';
      if (!bcrypt.compareSync(String(pin || ''), A.pin_hash)) { await Q('update users set pin_fail=pin_fail+1 where id=$1', [A.user_id]); throw 'PIN salah'; }
      if (A.pin_fail) await Q('update users set pin_fail=0 where id=$1', [A.user_id]);
      const p = (await c.query('select * from products where id=$1', [A.product_id])).rows[0];
      if (A.balance - amount < p.min_bal) throw 'Saldo tidak cukup (saldo minimal ' + p.min_bal + ')';
      const used = (await c.query(`select coalesce(sum(amount),0) s from tx where from_no=$1 and date::date=current_date and type<>'biaya'`, [from])).rows[0].s;
      if (p.daily_limit && used + amount > p.daily_limit) throw 'Melebihi limit harian ' + p.daily_limit;
      await c.query('update accounts set balance=balance-$1 where no=$2', [amount, from]);
    }
    if (B) await c.query('update accounts set balance=balance+$1 where no=$2', [amount, to]);
    const after = A ? A.balance - amount : B.balance + amount;
    const t = (await c.query('insert into tx(type,from_no,to_no,amount,by_user,bal_after) values($1,$2,$3,$4,$5,$6) returning *', [type, from, to, amount, by, after])).rows[0];
    await c.query('commit');
    return mapTx(t);
  } catch (e) { await c.query('rollback'); throw e; } finally { c.release(); }
}

// ===== AUTH & REGISTRASI =====
app.post('/api/login', limit('login', 10, 60), h(async (q, s) => {
  const u = await Q1(`select ${UCOLS} from users where username=$1`, [q.body.username]);
  if (u && u.locked_until && new Date(u.locked_until) > new Date()) throw 'Akun terkunci sementara karena salah password. Coba lagi 15 menit lagi';
  if (!u || !bcrypt.compareSync(q.body.password || '', u.pass_hash)) {
    if (u) await Q(`update users set fail_count=fail_count+1, locked_until=case when fail_count+1>=5 then now()+interval '15 minutes' end where id=$1`, [u.id]);
    throw 'Username/password salah';
  }
  if (u.fail_count) await Q('update users set fail_count=0, locked_until=null where id=$1', [u.id]);
  if (u.status === 'pending') throw 'Pendaftaran Anda masih menunggu persetujuan admin';
  if (u.status !== 'active') throw 'Akun tidak aktif / ditolak. Hubungi admin';
  q.u = u; await log(q, 'LOGIN');
  s.setHeader('Set-Cookie', 'mb=' + jwt.sign({ id: u.id }, SECRET, { expiresIn: '8h' }) + '; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800' + (process.env.VERCEL ? '; Secure' : ''));
  return { ok: 1 };
}));
app.post('/api/register', limit('reg', 5, 3600), h(async q => {
  const b = q.body; await chk(b);
  if (!/^\d{9,15}$/.test((b.wa || '').replace(/\D/g, ''))) throw 'Nomor WhatsApp tidak valid';
  if (!/^data:image\/(jpeg|png|webp);base64,/.test(b.idPhoto || '')) throw 'Foto KTP/Kartu Pelajar wajib diunggah';
  await Q(`insert into users(username,name,role,status,wa,nik,id_photo,pass_hash,pin_hash) values($1,$2,'nasabah','pending',$3,$4,$5,$6,$7)`,
    [b.username, b.name, b.wa, b.nik || '', b.idPhoto, bcrypt.hashSync(b.password, 10), bcrypt.hashSync(b.pin, 10)]);
  q.u = { username: b.username }; await log(q, 'REGISTRASI', b.name);
}));
app.post('/api/logout', h((q, s) => { s.setHeader('Set-Cookie', 'mb=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'); }));
app.get('/api/me', auth(), h(async q => ({ user: pub(q.u), account: mapAcc(await Q1('select * from accounts where user_id=$1', [q.u.id])) || null })));
app.post('/api/me/security', auth(), h(async q => {
  const { old, password, pin } = q.body;
  if (!bcrypt.compareSync(old || '', q.u.pass_hash)) throw 'Password lama salah';
  if (password) { if (password.length < 8) throw 'Password min 8'; await Q('update users set pass_hash=$1 where id=$2', [bcrypt.hashSync(password, 10), q.u.id]); }
  if (pin) { if (!/^\d{6}$/.test(pin)) throw 'PIN harus 6 digit'; await Q('update users set pin_hash=$1 where id=$2', [bcrypt.hashSync(pin, 10), q.u.id]); }
  await log(q, 'UBAH_KEAMANAN');
}));

// ===== ADMIN =====
app.get('/api/users', auth('admin'), h(async () => (await Q('select u.id,u.username,u.name,u.role,u.status,u.wa,u.nik,u.created,(u.id_photo is not null) has_photo,a.no acc from users u left join accounts a on a.user_id=u.id order by u.id desc')).map(u => ({ ...pub(u), acc: u.acc }))));
app.get('/api/photo/:id', auth('admin'), async (q, s) => {
  const u = await Q1('select id_photo from users where id=$1', [q.params.id]);
  if (!u || !u.id_photo) return s.sendStatus(404);
  s.type('image/jpeg').send(Buffer.from(u.id_photo.split(',')[1], 'base64'));
});
app.post('/api/users', auth('admin'), h(async q => {
  const b = q.body; await chk(b);
  if (!['admin', 'teller'].includes(b.role)) throw 'Role tidak valid';
  await Q(`insert into users(username,name,role,status,pass_hash,pin_hash) values($1,$2,$3,'active',$4,$5)`, [b.username, b.name, b.role, bcrypt.hashSync(b.password, 10), bcrypt.hashSync(b.pin, 10)]);
  await log(q, 'TAMBAH_USER', b.username + ' (' + b.role + ')');
}));
app.post('/api/users/:id/status', auth('admin'), h(async q => {
  const u = await Q1(`select ${UCOLS} from users where id=$1`, [q.params.id]);
  if (!u) throw 'User tidak ditemukan';
  if (u.id === q.u.id) throw 'Tidak bisa mengubah akun sendiri';
  if (!['active', 'inactive', 'rejected'].includes(q.body.status)) throw 'Status tidak valid';
  await Q('update users set status=$1 where id=$2', [q.body.status, u.id]);
  let a = await Q1('select * from accounts where user_id=$1', [u.id]);
  if (q.body.status === 'active' && u.role === 'nasabah' && !a) a = await newAccount(u.id, q.body.productId || 1);
  await log(q, 'STATUS_USER', u.username + ' -> ' + q.body.status);
  return { accountNo: a && a.no, wa: u.wa, name: u.name, status: q.body.status };
}));
app.post('/api/users/:id/reset', auth('admin'), h(async q => {
  const u = await Q1(`select ${UCOLS} from users where id=$1`, [q.params.id]);
  if (!u) throw 'User tidak ditemukan';
  if (q.body.password) await Q('update users set pass_hash=$1 where id=$2', [bcrypt.hashSync(q.body.password, 10), u.id]);
  if (q.body.pin) await Q('update users set pin_hash=$1 where id=$2', [bcrypt.hashSync(q.body.pin, 10), u.id]);
  await Q('update users set pin_fail=0,fail_count=0,locked_until=null where id=$1', [u.id]);
  await log(q, 'RESET_KREDENSIAL', u.username);
}));
app.delete('/api/users/:id', auth('admin'), h(async q => {
  const u = await Q1(`select ${UCOLS} from users where id=$1`, [q.params.id]);
  if (!u || u.id === q.u.id) throw 'Tidak bisa dihapus';
  const a = await Q1('select * from accounts where user_id=$1', [u.id]);
  if (a && a.balance > 0) throw 'Saldo rekening masih ada';
  await Q('delete from users where id=$1', [u.id]);
  await log(q, 'HAPUS_USER', u.username);
}));
app.get('/api/products', auth(), h(async () => (await Q('select * from products order by id')).map(p => ({ id: p.id, name: p.name, minBal: p.min_bal, adminFee: p.admin_fee, dailyLimit: p.daily_limit }))));
app.post('/api/products', auth('admin'), h(async q => {
  const b = q.body, v = [b.name, +b.minBal, +b.adminFee, +b.dailyLimit];
  if (b.id) await Q('update products set name=$1,min_bal=$2,admin_fee=$3,daily_limit=$4 where id=$5', [...v, b.id]);
  else await Q('insert into products(name,min_bal,admin_fee,daily_limit) values($1,$2,$3,$4)', v);
  await log(q, 'SIMPAN_PRODUK', b.name);
}));
app.post('/api/fees', auth('admin'), h(async q => {
  const r = await Q(`with u as (update accounts a set balance=balance-p.admin_fee from products p, users us where p.id=a.product_id and us.id=a.user_id and us.status='active' and p.admin_fee>0 and a.balance>=p.admin_fee returning a.no,p.admin_fee fee,a.balance)
    insert into tx(type,from_no,amount,by_user,bal_after) select 'biaya',no,fee,'sistem',balance from u returning id`);
  await log(q, 'BIAYA_ADMIN_BULANAN', r.length + ' rekening');
  return { n: r.length };
}));
app.get('/api/report', auth('admin'), h(async () => ({ tx: (await Q('select * from tx order by id')).map(mapTx), total: (await Q1('select coalesce(sum(balance),0) s from accounts')).s })));
app.get('/api/logs', auth('admin'), h(async () => (await Q('select * from logs order by id desc limit 500')).map(l => ({ date: l.date, user: l.username, action: l.action, detail: l.detail }))));
app.get('/api/backup', auth('admin'), async (q, s) => {
  await log(q, 'BACKUP');
  const d = {}; for (const t of ['products', 'users', 'accounts', 'tx', 'logs', 'cash']) d[t] = await Q('select * from ' + t);
  d.users.forEach(u => { delete u.id_photo; delete u.pass_hash; delete u.pin_hash; });
  s.setHeader('Content-Disposition', 'attachment; filename=backup.json'); s.json(d);
});
app.post('/api/restore', auth('admin'), h(() => { throw 'Restore dilakukan lewat Supabase Dashboard > Database > Backups'; }));

// ===== REKENING & TRANSAKSI =====
app.get('/api/account/:no', auth(), h(async q => {
  const a = await Q1('select a.*,u.name,u.status from accounts a join users u on u.id=a.user_id where a.no=$1', [q.params.no]);
  if (!a) throw 'Rekening tidak ditemukan';
  if (a.status !== 'active') throw 'Rekening nonaktif';
  return { no: a.no, name: a.name, balance: q.u.role === 'nasabah' ? undefined : a.balance };
}));
app.get('/api/mutasi/:no', auth(), h(async q => {
  const a = await Q1('select a.*,u.name from accounts a join users u on u.id=a.user_id where a.no=$1', [q.params.no]);
  if (!a) throw 'Rekening tidak ditemukan';
  if (q.u.role === 'nasabah' && a.user_id !== q.u.id) throw 'Bukan rekening Anda';
  return { name: a.name, balance: a.balance, tx: (await Q('select * from tx where from_no=$1 or to_no=$1 order by id desc', [a.no])).map(mapTx) };
}));
app.post('/api/tx', auth('teller'), h(async q => {
  const { type, from, to, amount, pin } = q.body;
  if (!['setor', 'tarik', 'transfer'].includes(type)) throw 'Jenis tidak valid';
  const t = await doTx(type, type === 'setor' ? null : from, type === 'tarik' ? null : to, amount, q.u.username, pin);
  await log(q, 'TX_' + type.toUpperCase(), `${from || ''}>${to || ''} ${t.amount}`);
  return t;
}));
app.post('/api/transfer', auth('nasabah'), h(async q => {
  const a = await Q1('select * from accounts where user_id=$1', [q.u.id]);
  if (!a) throw 'Anda belum punya rekening';
  const t = await doTx('transfer', a.no, q.body.to, q.body.amount, q.u.username, q.body.pin);
  await log(q, 'TX_TRANSFER', `${a.no}>${q.body.to} ${t.amount}`);
  return t;
}));
app.post('/api/open', auth('teller'), h(async q => {
  const b = q.body; await chk(b);
  const u = await Q1(`insert into users(username,name,role,status,wa,nik,pass_hash,pin_hash) values($1,$2,'nasabah','active',$3,$4,$5,$6) returning id`,
    [b.username, b.name, b.wa || '', b.nik || '', bcrypt.hashSync(b.password, 10), bcrypt.hashSync(b.pin, 10)]);
  const a = await newAccount(u.id, b.productId || 1);
  await log(q, 'BUKA_REKENING', a.no + ' ' + b.name);
  return { no: a.no, name: b.name };
}));

// ===== KAS TELLER =====
const myCash = q => Q1('select * from cash where teller_id=$1 and date=current_date', [q.u.id]);
const cashFlow = async q => {
  const r = await Q1(`select coalesce(sum(amount) filter (where type='setor'),0) masuk, coalesce(sum(amount) filter (where type='tarik'),0) keluar from tx where by_user=$1 and date::date=current_date`, [q.u.username]);
  return { masuk: r.masuk, keluar: r.keluar };
};
const mapCash = c => c && { id: c.id, open: c.open_amt, closed: c.closed, expected: c.expected, physical: c.physical, diff: c.diff };
app.get('/api/cash', auth('teller'), h(async q => ({ cash: mapCash(await myCash(q)) || null, ...(await cashFlow(q)) })));
app.post('/api/cash/open', auth('teller'), h(async q => {
  if (await myCash(q)) throw 'Kas hari ini sudah dibuka';
  await Q('insert into cash(teller_id,open_amt) values($1,$2)', [q.u.id, +q.body.amount]); await log(q, 'BUKA_KAS');
}));
app.post('/api/cash/close', auth('teller'), h(async q => {
  const c = await myCash(q);
  if (!c || c.closed) throw 'Kas belum dibuka / sudah ditutup';
  const f = await cashFlow(q), exp = c.open_amt + f.masuk - f.keluar, ph = +q.body.physical;
  await Q('update cash set expected=$1,physical=$2,diff=$3,closed=true where id=$4', [exp, ph, ph - exp, c.id]);
  await log(q, 'TUTUP_KAS', 'selisih ' + (ph - exp));
}));

module.exports = app;
