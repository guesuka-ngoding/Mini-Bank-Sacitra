const $ = s => document.querySelector(s), v = id => document.getElementById(id).value;
const rp = n => 'Rp ' + Number(n || 0).toLocaleString('id-ID');
const fd = d => new Date(d).toLocaleString('id-ID');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const wa = (n, t) => 'https://wa.me/' + String(n).replace(/\D/g, '').replace(/^0/, '62') + '?text=' + encodeURIComponent(t);
let T = 1, U, ACC;

async function api(p, m = 'GET', b) {
  const r = await fetch('/api/' + p, { method: m, headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) { if (r.status === 401 && p !== 'me' && p !== 'login') logout(); throw new Error(d.error || 'Terjadi kesalahan'); }
  return d;
}
const go = f => async (...a) => { try { await f(...a); } catch (e) { alert(e.message); } };
const authTab = t => { $('#f_login').classList.toggle('hide', t !== 'login'); $('#f_reg').classList.toggle('hide', t !== 'reg'); };
const logout = () => { fetch('/api/logout', { method: 'POST' }).finally(() => location.reload()); };

function compress(file) {
  return new Promise((res, rej) => {
    const i = new Image();
    i.onerror = () => rej(new Error('File foto tidak bisa dibaca, pilih gambar lain'));
    i.onload = () => { const c = document.createElement('canvas'), s = Math.min(1, 900 / i.width); c.width = i.width * s; c.height = i.height * s; c.getContext('2d').drawImage(i, 0, 0, c.width, c.height); res(c.toDataURL('image/jpeg', .7)); };
    i.src = URL.createObjectURL(file);
  });
}

const login = go(async () => {
  const r = await api('login', 'POST', { username: v('l_user'), password: v('l_pass') });
  boot();
});
const register = go(async () => {
  const f = $('#r_foto').files[0];
  if (!f) throw new Error('Foto KTP/Kartu Pelajar wajib diunggah');
  await api('register', 'POST', { name: v('r_name'), nik: v('r_nik'), wa: v('r_wa'), username: v('r_user'), password: v('r_pass'), pin: v('r_pin'), idPhoto: await compress(f) });
  alert('Pendaftaran terkirim! Admin akan menghubungi Anda via WhatsApp setelah data diverifikasi.'); authTab('login');
});

const MENU = {
  admin: [['users', 'Pengguna'], ['produk', 'Produk'], ['laporan', 'Laporan'], ['log', 'Audit & Backup']],
  teller: [['trx', 'Transaksi'], ['buka', 'Buka Rekening'], ['cetak', 'Mutasi'], ['kas', 'Kas Harian']],
  nasabah: [['home', 'Rekening'], ['mutasi', 'Mutasi'], ['transfer', 'Transfer'], ['akun', 'Keamanan']]
};

async function boot() {
  if (!T) { $('#auth').classList.remove('hide'); return; }
  try { const m = await api('me'); U = m.user; ACC = m.account; } catch { $('#auth').classList.remove('hide'); return; }
  $('#auth').classList.add('hide'); $('#app').classList.remove('hide');
  $('#who').textContent = U.name + ' (' + U.role + ')';
  $('#nav').innerHTML = MENU[U.role].map(([k, l]) => `<button data-k="${k}" onclick="nav('${k}')">${l}</button>`).join('');
  nav(MENU[U.role][0][0]);
}
const nav = go(async k => {
  document.querySelectorAll('#nav button').forEach(b => b.classList.toggle('on', b.dataset.k === k));
  $('#main').innerHTML = await V[k]();
});

// ===== util tabel & struk =====
const tbl = (rows, no) => `<div class="wrap"><table><tr><th>Tanggal</th><th>Jenis</th><th>Keterangan</th><th>Masuk</th><th>Keluar</th></tr>${rows.map(t => {
  const out = t.from === no;
  return `<tr><td>${fd(t.date)}</td><td>${t.type}</td><td>${t.from && t.to ? (out ? 'ke ' + t.to : 'dari ' + t.from) : ''}</td><td>${out ? '' : rp(t.amount)}</td><td>${out ? rp(t.amount) : ''}</td></tr>`;
}).join('')}</table></div>`;
const struk = t => {
  const w = window.open('', '', 'width=380,height=520');
  w.document.write(`<pre style="font:13px monospace">MINI BANK\n--------------------------\nNo   : ${t.id}\nTgl  : ${fd(t.date)}\nJenis: ${t.type.toUpperCase()}\nDari : ${t.from || '-'}\nKe   : ${t.to || '-'}\nNominal: ${rp(t.amount)}\nSaldo  : ${rp(t.balAfter)}\nTeller : ${esc(t.by)}\n--------------------------\nSimpan struk ini</pre>`);
  w.document.close(); w.print();
};
const download = (name, text, type = 'text/csv') => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click(); };

// ===== VIEWS =====
const V = {
  // ---------- ADMIN ----------
  async users() {
    const us = await api('users');
    window._us = us;
    return `<div class="card"><h3>Tambah Admin / Teller</h3><div class="row"><input id="s_name" placeholder="Nama"><input id="s_user" placeholder="Username"><input id="s_pass" type="password" placeholder="Password"><input id="s_pin" placeholder="PIN 6 digit"><select id="s_role"><option>teller</option><option>admin</option></select></div><button class="pri" onclick="addStaff()">Tambah</button></div>
    <div class="card wrap"><h3>Daftar Pengguna</h3><table><tr><th>Nama</th><th>Role</th><th>Status</th><th>WhatsApp</th><th>KTP</th><th>Aksi</th></tr>${us.map(u => `<tr>
      <td>${esc(u.name)}<br><small>${esc(u.username)} ${u.acc ? '· ' + u.acc : ''}</small></td><td>${u.role}</td><td><span class="badge ${u.status}">${u.status}</span></td>
      <td>${u.wa ? `<a target="_blank" href="${wa(u.wa, 'Halo ' + u.name + ', kami dari Mini Bank.')}">${esc(u.wa)}</a>` : '-'}</td>
      <td>${u.hasPhoto ? `<a target="_blank" href="/api/photo/${u.id}">Lihat</a>` : '-'}</td>
      <td>${u.status === 'pending' ? `<button class="sm" onclick="st(${u.id},'active')">✔ Setujui</button><button class="sm red" onclick="st(${u.id},'rejected')">✖ Tolak</button>` : ''}
      ${u.status === 'active' ? `<button class="sm" onclick="st(${u.id},'inactive')">Nonaktifkan</button>` : ''}${['inactive', 'rejected'].includes(u.status) ? `<button class="sm" onclick="st(${u.id},'active')">Aktifkan</button>` : ''}
      <button class="sm" onclick="reset(${u.id})">Reset</button><button class="sm red" onclick="del(${u.id})">Hapus</button></td></tr>`).join('')}</table></div>`;
  },
  async produk() {
    const ps = await api('products');
    const row = p => `<tr><td><input id="p_n${p.id}" value="${esc(p.name)}"></td><td><input id="p_m${p.id}" type="number" value="${p.minBal}"></td><td><input id="p_f${p.id}" type="number" value="${p.adminFee}"></td><td><input id="p_l${p.id}" type="number" value="${p.dailyLimit}"></td><td><button class="sm" onclick="saveProd(${p.id})">Simpan</button></td></tr>`;
    return `<div class="card wrap"><h3>Jenis Tabungan</h3><table><tr><th>Nama</th><th>Saldo minimal</th><th>Biaya admin/bln</th><th>Limit harian (0=tanpa)</th><th></th></tr>${ps.map(row).join('')}${row({ id: 0, name: '', minBal: 0, adminFee: 0, dailyLimit: 0 })}</table>
    <button class="pri" onclick="chargeFees()">Bebankan Biaya Admin Bulanan Sekarang</button></div>`;
  },
  async laporan() {
    const r = await api('report'); window._tx = r.tx; window._total = r.total;
    return `<div class="stat" id="stat"></div><div class="card"><div class="row"><select id="per" onchange="recap()"><option value="10">Harian</option><option value="7">Bulanan</option><option value="4">Tahunan</option></select><button onclick="exportCsv()">Ekspor Excel (CSV)</button><button onclick="print()">Cetak / Simpan PDF</button></div><div id="rec" class="wrap"></div></div><img src="data:," onerror="recap()" class="hide">`;
  },
  async log() {
    const l = await api('logs');
    return `<div class="card"><h3>Backup & Restore</h3><button onclick="backup()">Unduh Backup Database</button> <input type="file" id="rs" accept=".json" onchange="restore()"></div>
    <div class="card wrap"><h3>Audit Log</h3><table><tr><th>Waktu</th><th>User</th><th>Aksi</th><th>Detail</th></tr>${l.map(x => `<tr><td>${fd(x.date)}</td><td>${esc(x.user)}</td><td>${x.action}</td><td>${esc(x.detail)}</td></tr>`).join('')}</table></div>`;
  },
  // ---------- TELLER ----------
  async trx() {
    return `<div class="card"><h3>Setor / Tarik / Transfer</h3><select id="t_type" onchange="$('#t_to').classList.toggle('hide',this.value!=='transfer')"><option value="setor">Setor Tunai</option><option value="tarik">Tarik Tunai</option><option value="transfer">Transfer / Pindah Buku</option></select>
    <input id="t_no" placeholder="No. rekening (sumber/nasabah)" onblur="lookup('t_no','t_nm')"><small id="t_nm" class="muted"></small>
    <input id="t_to" class="hide" placeholder="No. rekening tujuan" onblur="lookup('t_to','t_nm2')"><small id="t_nm2" class="muted"></small>
    <input id="t_amt" type="number" placeholder="Nominal"><input id="t_pin" type="password" maxlength="6" placeholder="PIN nasabah (tarik/transfer)"><button class="pri" onclick="doTrx()">Proses</button></div>`;
  },
  async buka() {
    const ps = await api('products');
    return `<div class="card"><h3>Pembukaan Rekening Baru</h3><p class="muted">Verifikasi KTP/Kartu Pelajar asli nasabah sebelum menyimpan.</p><input id="o_name" placeholder="Nama sesuai identitas"><input id="o_nik" placeholder="NIK / NIS"><input id="o_wa" placeholder="No. WhatsApp"><input id="o_user" placeholder="Username"><input id="o_pass" type="password" placeholder="Password"><input id="o_pin" placeholder="PIN 6 digit"><select id="o_prod">${ps.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select><button class="pri" onclick="openAcc()">Buat Rekening</button></div>`;
  },
  async cetak() {
    return `<div class="card"><h3>Cetak Mutasi</h3><input id="m_no" placeholder="No. rekening"><button class="pri" onclick="showMut('m_no','m_out')">Tampilkan</button></div><div id="m_out"></div>`;
  },
  async kas() {
    const r = await api('cash'), c = r.cash;
    if (!c) return `<div class="card"><h3>Buka Kas</h3><input id="k_amt" type="number" placeholder="Saldo awal kasir"><button class="pri" onclick="cashOpen()">Buka Kas</button></div>`;
    return `<div class="card"><h3>Kas Hari Ini ${c.closed ? '(DITUTUP)' : ''}</h3><p>Saldo awal: <b>${rp(c.open)}</b><br>Uang masuk (setor): <b>${rp(r.masuk)}</b><br>Uang keluar (tarik): <b>${rp(r.keluar)}</b><br>Saldo seharusnya: <b>${rp(c.open + r.masuk - r.keluar)}</b></p>
    ${c.closed ? `<p>Uang fisik: ${rp(c.physical)}<br>Selisih: <b>${rp(c.diff)}</b></p>` : `<input id="k_ph" type="number" placeholder="Jumlah uang fisik di laci"><button class="pri" onclick="cashClose()">Tutup Kas</button>`}</div>`;
  },
  // ---------- NASABAH ----------
  async home() {
    if (!ACC) return '<div class="card">Rekening belum tersedia.</div>';
    const m = await api('mutasi/' + ACC.no);
    return `<div class="bankcard"><div>MINI BANK</div><div class="no">${ACC.no}</div><div>${esc(U.name)}</div><div style="font-size:12px;margin-top:10px">Saldo</div><b style="font-size:24px">${rp(m.balance)}</b></div>`;
  },
  async mutasi() {
    if (!ACC) return '';
    window._m = (await api('mutasi/' + ACC.no)).tx;
    return `<div class="card"><div class="row"><input id="f1" type="date"><input id="f2" type="date"><select id="f3"><option value="">Semua jenis</option><option>setor</option><option>tarik</option><option>transfer</option><option>biaya</option></select><input id="f4" type="number" placeholder="Nominal min"></div><button onclick="filt()">Terapkan</button> <button onclick="print()">Unduh e-Statement (PDF)</button></div><div class="card" id="mt"></div><img src="data:," onerror="filt()" class="hide">`;
  },
  async transfer() {
    return `<div class="card"><h3>Transfer Sesama Nasabah</h3><input id="x_to" placeholder="No. rekening tujuan" onblur="lookup('x_to','x_nm')"><b id="x_nm"></b><input id="x_amt" type="number" placeholder="Nominal"><input id="x_pin" type="password" maxlength="6" placeholder="PIN transaksi"><button class="pri" onclick="doTransfer()">Kirim</button></div>`;
  },
  async akun() {
    return `<div class="card"><h3>Ubah Password / PIN</h3><input id="a_old" type="password" placeholder="Password lama"><input id="a_new" type="password" placeholder="Password baru (kosongkan jika tidak diubah)"><input id="a_pin" type="password" maxlength="6" placeholder="PIN baru 6 digit (opsional)"><button class="pri" onclick="chgSec()">Simpan</button></div>`;
  }
};

// ===== ACTIONS =====
const addStaff = go(async () => { await api('users', 'POST', { name: v('s_name'), username: v('s_user'), password: v('s_pass'), pin: v('s_pin'), role: v('s_role') }); nav('users'); });
const st = go(async (id, s) => {
  const r = await api('users/' + id + '/status', 'POST', { status: s });
  if (s === 'active' && r.accountNo && r.wa && confirm('Disetujui. Kirim info ke WhatsApp nasabah sekarang?'))
    window.open(wa(r.wa, `Halo ${r.name}, pendaftaran Mini Bank Anda telah DISETUJUI. No. rekening: ${r.accountNo}. Silakan login dengan username & password yang Anda daftarkan.`));
  if (s === 'rejected' && r.wa && confirm('Ditolak. Kirim info ke WhatsApp nasabah?'))
    window.open(wa(r.wa, `Halo ${r.name}, mohon maaf pendaftaran Mini Bank Anda belum dapat disetujui. Silakan daftar ulang dengan foto identitas yang jelas.`));
  nav('users');
});
const reset = go(async id => { const p = prompt('Password baru (kosongkan jika tidak diubah):'), n = prompt('PIN baru 6 digit (kosongkan jika tidak diubah):'); await api('users/' + id + '/reset', 'POST', { password: p, pin: n }); alert('Berhasil direset'); });
const del = go(async id => { if (confirm('Hapus pengguna ini?')) { await api('users/' + id, 'DELETE'); nav('users'); } });
const saveProd = go(async id => { await api('products', 'POST', { id: id || undefined, name: v('p_n' + id), minBal: v('p_m' + id), adminFee: v('p_f' + id), dailyLimit: v('p_l' + id) }); nav('produk'); });
const chargeFees = go(async () => { if (confirm('Bebankan biaya admin ke semua rekening?')) { const r = await api('fees', 'POST'); alert(r.n + ' rekening dikenai biaya'); } });
const backup = go(async () => { const r = await api('backup'); download('backup.json', JSON.stringify(r), 'application/json'); });
const restore = go(async () => { const f = $('#rs').files[0]; if (f && confirm('Timpa seluruh data dengan backup ini?')) { await api('restore', 'POST', JSON.parse(await f.text())); alert('Restore berhasil'); nav('log'); } });

function recap() {
  const n = +v('per'), g = {};
  window._tx.forEach(t => { const k = t.date.slice(0, n); g[k] = g[k] || { in: 0, out: 0, c: 0 }; if (t.type === 'setor') g[k].in += t.amount; if (t.type === 'tarik') g[k].out += t.amount; g[k].c++; });
  const all = window._tx.reduce((s, t) => ({ in: s.in + (t.type === 'setor' ? t.amount : 0), out: s.out + (t.type === 'tarik' ? t.amount : 0) }), { in: 0, out: 0 });
  $('#stat').innerHTML = `<div class="card">Kas Masuk<b>${rp(all.in)}</b></div><div class="card">Kas Keluar<b>${rp(all.out)}</b></div><div class="card">Total Saldo Tersimpan<b>${rp(window._total)}</b></div>`;
  window._rows = Object.keys(g).sort().reverse().map(k => [k, g[k].c, g[k].in, g[k].out]);
  $('#rec').innerHTML = `<table><tr><th>Periode</th><th>Jml Transaksi</th><th>Kas Masuk</th><th>Kas Keluar</th></tr>${window._rows.map(r => `<tr><td>${r[0]}</td><td>${r[1]}</td><td>${rp(r[2])}</td><td>${rp(r[3])}</td></tr>`).join('')}</table>`;
}
const exportCsv = () => download('laporan.csv', 'Periode,Jumlah Transaksi,Kas Masuk,Kas Keluar\n' + window._rows.map(r => r.join(',')).join('\n'));

const lookup = async (id, out) => { try { const r = await api('account/' + v(id)); $('#' + out).textContent = '✔ ' + r.name; } catch (e) { $('#' + out).textContent = '✖ ' + e.message; } };
const doTrx = go(async () => {
  const t = v('t_type'), no = v('t_no');
  const r = await api('tx', 'POST', { type: t, from: t === 'transfer' || t === 'tarik' ? no : null, to: t === 'setor' ? no : v('t_to'), amount: v('t_amt'), pin: v('t_pin') });
  alert('Transaksi berhasil'); struk(r);
});
const openAcc = go(async () => { const r = await api('open', 'POST', { name: v('o_name'), nik: v('o_nik'), wa: v('o_wa'), username: v('o_user'), password: v('o_pass'), pin: v('o_pin'), productId: v('o_prod') }); alert('Rekening dibuat: ' + r.no); nav('buka'); });
const showMut = go(async (inp, out) => {
  const r = await api('mutasi/' + v(inp));
  $('#' + out).innerHTML = `<div class="card"><h3>Mutasi Rekening ${esc(r.name)}</h3><p>Saldo: <b>${rp(r.balance)}</b></p>${tbl(r.tx, v(inp))}<button onclick="print()">Cetak</button></div>`;
});
const cashOpen = go(async () => { await api('cash/open', 'POST', { amount: v('k_amt') }); nav('kas'); });
const cashClose = go(async () => { if (confirm('Tutup kas hari ini?')) { await api('cash/close', 'POST', { physical: v('k_ph') }); nav('kas'); } });
const filt = () => {
  const a = v('f1'), b = v('f2'), c = v('f3'), d = +v('f4') || 0;
  const rows = window._m.filter(t => (!a || t.date.slice(0, 10) >= a) && (!b || t.date.slice(0, 10) <= b) && (!c || t.type === c) && t.amount >= d);
  $('#mt').innerHTML = `<h3>e-Statement ${esc(U.name)} — ${ACC.no}</h3>` + tbl(rows, ACC.no);
};
const doTransfer = go(async () => {
  const nm = $('#x_nm').textContent;
  if (!nm.startsWith('✔') || !confirm('Kirim ' + rp(v('x_amt')) + ' ke ' + nm.slice(2) + '?')) return;
  await api('transfer', 'POST', { to: v('x_to'), amount: v('x_amt'), pin: v('x_pin') }); alert('Transfer berhasil'); nav('home');
});
const chgSec = go(async () => { await api('me/security', 'POST', { old: v('a_old'), password: v('a_new'), pin: v('a_pin') }); alert('Tersimpan'); });

boot();
