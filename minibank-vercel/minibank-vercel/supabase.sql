-- Jalankan di Supabase > SQL Editor (aman diulang). Ganti password app_server (1 tempat, di bawah) sebelum Run!
create table if not exists products (id serial primary key, name text not null, min_bal bigint default 0, admin_fee bigint default 0, daily_limit bigint default 0);
create table if not exists users (
  id serial primary key, username text unique not null, name text not null,
  role text not null check (role in ('admin','teller','nasabah')),
  status text not null default 'pending' check (status in ('pending','active','inactive','rejected')),
  wa text, nik text, id_photo text, pass_hash text not null, pin_hash text not null,
  fail_count int default 0, pin_fail int default 0, locked_until timestamptz, created timestamptz default now());
create table if not exists accounts (no text primary key, user_id int references users(id) on delete cascade, product_id int references products(id), balance bigint default 0 check (balance >= 0), created timestamptz default now());
create table if not exists tx (id serial primary key, date timestamptz default now(), type text not null, from_no text, to_no text, amount bigint not null check (amount > 0), by_user text, bal_after bigint);
create table if not exists logs (id serial primary key, date timestamptz default now(), username text, action text, detail text);
create table if not exists cash (id serial primary key, teller_id int references users(id), date date default current_date, open_amt bigint, expected bigint, physical bigint, diff bigint, closed boolean default false);
create table if not exists rate_limit (key text primary key, hits int not null, reset_at timestamptz not null);
create index if not exists i_tx_from on tx(from_no); create index if not exists i_tx_to on tx(to_no); create index if not exists i_tx_date on tx(date);
create index if not exists i_acc_user on accounts(user_id); create index if not exists i_logs_date on logs(date);
insert into products(name,min_bal,admin_fee,daily_limit) select * from (values ('Tabungan Umum',10000,1000,5000000),('Tabungan Siswa',5000,0,1000000),('Deposito',1000000,5000,0)) v where not exists (select 1 from products);

-- KEAMANAN 1: RLS aktif + cabut semua akses API publik Supabase (anon/authenticated)
alter table products enable row level security; alter table users enable row level security; alter table accounts enable row level security;
alter table tx enable row level security; alter table logs enable row level security; alter table cash enable row level security; alter table rate_limit enable row level security;
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated;

-- KEAMANAN 2: role khusus aplikasi (least privilege). tx & logs hanya bisa INSERT/SELECT = tidak bisa diubah/dihapus
do $$ begin if not exists (select 1 from pg_roles where rolname='app_server') then create role app_server login; end if; end $$;
alter role app_server with login password 'Muta_Suka_Koding'; -- hanya SATU tempat yang perlu diganti; aman dijalankan ulang
alter role app_server set timezone to 'Asia/Jakarta';
grant usage on schema public to app_server;
grant select,insert,update,delete on users,accounts,products,cash,rate_limit to app_server;
grant select,insert on tx,logs to app_server;
grant usage,select on all sequences in schema public to app_server;
do $$ declare t text; begin foreach t in array array['users','accounts','products','cash','rate_limit','tx','logs'] loop
  execute format('drop policy if exists srv on %I', t);
  execute format('create policy srv on %I for all to app_server using (true) with check (true)', t);
end loop; end $$;
