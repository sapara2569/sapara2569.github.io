-- ============================================================
--  เว็บไซต์สภานักเรียนโรงเรียนร้องกวางอนุสรณ์
--  โครงสร้างฐานข้อมูล Supabase (PostgreSQL) + Row Level Security
--  ------------------------------------------------------------
--  วิธีใช้: เปิด Supabase Dashboard > SQL Editor > New query
--           วางไฟล์นี้ทั้งหมด แล้วกด Run (รันซ้ำได้ ไม่พัง)
-- ============================================================

-- ---------- 1. ตาราง ----------

-- แอดมิน: เพิ่ม uid ของผู้ใช้ที่จะเป็นแอดมินลงตารางนี้เอง (ดูวิธีใน README)
create table if not exists public.admins (
  id          uuid primary key references auth.users(id) on delete cascade,
  name        text,
  created_at  timestamptz not null default now()
);

-- คลังรายชื่อนักเรียนทั้งโรงเรียน (แอดมินนำเข้า ใช้ตรวจตอนลงทะเบียน)
create table if not exists public.roster (
  sid         text primary key,
  name        text not null,
  room        text not null,
  number      text not null,
  created_at  timestamptz not null default now()
);

-- บัญชีนักเรียนที่ลงทะเบียนเข้าใช้เว็บไซต์แล้ว
create table if not exists public.students (
  id          text primary key default gen_random_uuid()::text,
  auth_id     uuid unique references auth.users(id) on delete cascade,
  sid         text not null unique,
  name        text not null,
  room        text not null,
  number      text not null,
  email       text not null,
  photo       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists students_auth_idx on public.students(auth_id);

-- โหวตกิจกรรม (1 คน 1 เสียง)
create table if not exists public.votes (
  id          text primary key default gen_random_uuid()::text,
  sid         text not null unique,
  name        text not null,
  room        text not null,
  number      text not null,
  activity    text not null,
  like_level  smallint not null check (like_level between 1 and 5),
  suggest     text default '',
  created_at  timestamptz not null default now()
);

-- ผลแบบประเมินสภาพจิตใจ (ข้อมูลอ่อนไหว: นักเรียนเห็นเฉพาะของตัวเอง)
create table if not exists public.mental_results (
  id          text primary key default gen_random_uuid()::text,
  sid         text not null,
  name        text not null,
  room        text not null,
  number      text not null,
  answers     jsonb not null default '[]'::jsonb,
  score       smallint,
  level       smallint not null check (level between 1 and 5),
  created_at  timestamptz not null default now()
);
create index if not exists mental_sid_idx on public.mental_results(sid);

-- ปัญหาภายในโรงเรียน
create table if not exists public.problems (
  id          text primary key default gen_random_uuid()::text,
  sid         text,
  name        text,
  room        text,
  number      text,
  reported_by text default '',
  problem     text not null,
  place       text not null,
  severity    smallint not null default 3 check (severity between 1 and 5),
  detail      text default '',
  photos      text[] not null default '{}',
  status      text not null default 'wait' check (status in ('wait','doing','done')),
  history     jsonb not null default '[]'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists problems_sid_idx on public.problems(sid);
create index if not exists problems_status_idx on public.problems(status);

-- งบประมาณ
create table if not exists public.budget (
  id          text primary key default gen_random_uuid()::text,
  item        text not null,
  total       numeric(12,2) not null default 0,
  actual      numeric(12,2) not null default 0,
  recorder    text not null,
  note        text default '',
  created_at  timestamptz not null default now()
);

-- คะแนนโหวตที่แอดมินเพิ่มเอง (จากการโหวตนอกระบบ)
create table if not exists public.vote_extra (
  id          text primary key default gen_random_uuid()::text,
  activity    text not null,
  count       integer not null default 0,
  created_at  timestamptz not null default now()
);

-- คะแนนความพึงพอใจเว็บไซต์ (1 คน 1 ครั้ง)
create table if not exists public.ratings (
  sid         text primary key,
  name        text,
  room        text,
  stars       smallint not null check (stars between 1 and 5),
  comment     text default '',
  created_at  timestamptz not null default now()
);

-- ค่าตั้งค่าของระบบ (เช่น เปิด/ปิดการตรวจสอบกับคลังรายชื่อ)
create table if not exists public.app_settings (
  key         text primary key,
  value       jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);
insert into public.app_settings(key, value)
values ('settings', '{"strictRoster": true}'::jsonb)
on conflict (key) do nothing;


-- ---------- 2. ฟังก์ชันช่วยตรวจสิทธิ์ ----------

-- เป็นแอดมินหรือไม่ (security definer เพื่อไม่ให้ RLS วนซ้ำ)
create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.admins a where a.id = auth.uid());
$$;

-- รหัสนักเรียนของคนที่ล็อกอินอยู่
create or replace function public.my_sid()
returns text
language sql stable security definer set search_path = public
as $$
  select s.sid from public.students s where s.auth_id = auth.uid() limit 1;
$$;

-- ต้องตรวจกับคลังรายชื่อไหม (ถ้าคลังว่างให้ผ่านเสมอ)
create or replace function public.roster_check_on()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce((select (value->>'strictRoster')::boolean from public.app_settings where key='settings'), true)
         and exists (select 1 from public.roster limit 1);
$$;

-- ข้อมูลที่กรอกตรงกับคลังรายชื่อไหม
create or replace function public.matches_roster(p_sid text, p_name text, p_room text, p_number text)
returns boolean
language sql stable security definer set search_path = public
as $$
  select case
    when not public.roster_check_on() then true
    else exists (
      select 1 from public.roster r
      where r.sid = p_sid
        and btrim(r.name)   = btrim(p_name)
        and btrim(r.room)   = btrim(p_room)
        and btrim(r.number) = btrim(p_number)
    )
  end;
$$;


-- ---------- 3. เปิด Row Level Security ----------

alter table public.admins          enable row level security;
alter table public.roster          enable row level security;
alter table public.students        enable row level security;
alter table public.votes           enable row level security;
alter table public.mental_results  enable row level security;
alter table public.problems        enable row level security;
alter table public.budget          enable row level security;
alter table public.vote_extra      enable row level security;
alter table public.ratings         enable row level security;
alter table public.app_settings    enable row level security;

-- ล้าง policy เดิมก่อน (ให้รันไฟล์นี้ซ้ำได้)
do $$
declare r record;
begin
  for r in
    select schemaname, tablename, policyname from pg_policies
    where schemaname = 'public'
      and tablename in ('admins','roster','students','votes','mental_results',
                        'problems','budget','vote_extra','ratings','app_settings')
  loop
    execute format('drop policy %I on %I.%I', r.policyname, r.schemaname, r.tablename);
  end loop;
end $$;


-- ---------- 4. Policy ----------

-- admins: อ่านได้เพื่อเช็คตัวเอง / เพิ่มลบผ่าน Dashboard เท่านั้น
create policy admins_select on public.admins
  for select to authenticated using (true);

-- roster: ทุกคนที่ล็อกอินอ่านได้ / แอดมินเท่านั้นที่แก้ได้
create policy roster_select on public.roster
  for select to authenticated using (true);
create policy roster_write on public.roster
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- students: เห็นของตัวเอง หรือแอดมินเห็นทั้งหมด
create policy students_select on public.students
  for select to authenticated
  using (auth_id = auth.uid() or public.is_admin());

-- สมัครได้เฉพาะบัญชีตัวเอง อีเมลต้องตรงกับที่ล็อกอิน และต้องตรงกับคลังรายชื่อ
create policy students_insert_self on public.students
  for insert to authenticated
  with check (
    auth_id = auth.uid()
    and lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    and public.matches_roster(sid, name, room, number)
  );
create policy students_insert_admin on public.students
  for insert to authenticated with check (public.is_admin());

create policy students_update on public.students
  for update to authenticated
  using (auth_id = auth.uid() or public.is_admin())
  with check (auth_id = auth.uid() or public.is_admin());
create policy students_delete on public.students
  for delete to authenticated using (public.is_admin());

-- votes: ผลโหวตเป็นข้อมูลส่วนรวม ทุกคนอ่านได้ / แก้ได้เฉพาะของตัวเอง
create policy votes_select on public.votes
  for select to authenticated using (true);
create policy votes_insert on public.votes
  for insert to authenticated with check (sid = public.my_sid() or public.is_admin());
create policy votes_update on public.votes
  for update to authenticated
  using (sid = public.my_sid() or public.is_admin())
  with check (sid = public.my_sid() or public.is_admin());
create policy votes_delete on public.votes
  for delete to authenticated using (sid = public.my_sid() or public.is_admin());

-- mental_results: ข้อมูลอ่อนไหว นักเรียนเห็นเฉพาะของตัวเอง
create policy mental_select on public.mental_results
  for select to authenticated using (sid = public.my_sid() or public.is_admin());
create policy mental_insert on public.mental_results
  for insert to authenticated with check (sid = public.my_sid() or public.is_admin());
create policy mental_delete on public.mental_results
  for delete to authenticated using (public.is_admin());

-- problems: นักเรียนเห็นเฉพาะเรื่องที่ตัวเองแจ้ง / แอดมินเห็นและแก้สถานะได้ทั้งหมด
create policy problems_select on public.problems
  for select to authenticated using (sid = public.my_sid() or public.is_admin());
create policy problems_insert on public.problems
  for insert to authenticated with check (sid = public.my_sid() or public.is_admin());
create policy problems_update on public.problems
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy problems_delete on public.problems
  for delete to authenticated using (public.is_admin());

-- budget / vote_extra: ทุกคนอ่านได้ แอดมินเท่านั้นที่แก้
create policy budget_select on public.budget
  for select to authenticated using (true);
create policy budget_write on public.budget
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy vote_extra_select on public.vote_extra
  for select to authenticated using (true);
create policy vote_extra_write on public.vote_extra
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ratings: ทุกคนอ่านได้ (ไว้คำนวณค่าเฉลี่ย) แก้ได้เฉพาะของตัวเอง
create policy ratings_select on public.ratings
  for select to authenticated using (true);
create policy ratings_write on public.ratings
  for all to authenticated
  using (sid = public.my_sid() or public.is_admin())
  with check (sid = public.my_sid() or public.is_admin());

-- app_settings: ทุกคนอ่านได้ แอดมินเท่านั้นที่แก้
create policy settings_select on public.app_settings
  for select to authenticated using (true);
create policy settings_write on public.app_settings
  for all to authenticated using (public.is_admin()) with check (public.is_admin());


-- ---------- 5. เปิด Realtime ----------
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;

alter publication supabase_realtime add table public.roster;
alter publication supabase_realtime add table public.students;
alter publication supabase_realtime add table public.votes;
alter publication supabase_realtime add table public.mental_results;
alter publication supabase_realtime add table public.problems;
alter publication supabase_realtime add table public.budget;
alter publication supabase_realtime add table public.vote_extra;
alter publication supabase_realtime add table public.ratings;
alter publication supabase_realtime add table public.app_settings;


-- ---------- 6. ที่เก็บรูปภาพ ----------
insert into storage.buckets (id, name, public)
values ('photos', 'photos', false)
on conflict (id) do nothing;

drop policy if exists photos_read   on storage.objects;
drop policy if exists photos_insert on storage.objects;
drop policy if exists photos_delete on storage.objects;

-- อ่านรูปได้ทุกคนที่ล็อกอิน (ใช้ signed URL อายุสั้น)
create policy photos_read on storage.objects
  for select to authenticated using (bucket_id = 'photos');
create policy photos_insert on storage.objects
  for insert to authenticated with check (bucket_id = 'photos');
create policy photos_delete on storage.objects
  for delete to authenticated using (bucket_id = 'photos');
