-- =====================================================================
-- Horgásznapló – adatbázis-frissítés a 4. verzióra (Horgásztúra napló)
-- Futtatás: Supabase → SQL Editor → New query → a teljes szöveg
-- bemásolása → Run. Egyszer kell lefuttatni (többször is futtatható).
-- Feltétel: a 3. verziós frissítés (supabase_frissites_v3.sql) már lefutott.
-- =====================================================================

-- 8a. Vendég fogása (versenyen kívüli, csak a túranaplóban látszik)
alter table public.catches add column if not exists guest_name text;

-- 8b. Túrák
create table if not exists public.trips (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  water        text not null,                    -- a túra vízterülete
  lat          double precision,                 -- a túra helye (időjáráshoz, térképhez)
  lon          double precision,
  start_at     timestamptz not null,
  end_at       timestamptz not null,
  note         text,                             -- leírás, gyülekező, teendők
  created_by   uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz,
  notified_at  timestamptz,                      -- értesítés kiküldve
  constraint trips_time_ok check (end_at > start_at)
);
create index if not exists trips_start_idx on public.trips (start_at desc);

-- 8c. Résztvevők és jelentkezés (tag vagy vendég)
create table if not exists public.trip_people (
  id          uuid primary key default gen_random_uuid(),
  trip_id     uuid not null references public.trips(id) on delete cascade,
  user_id     uuid references public.profiles(id) on delete cascade,
  guest_name  text,
  rsvp        text not null default 'yes' check (rsvp in ('yes', 'maybe', 'no')),
  added_by    uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  constraint trip_people_one_kind check ((user_id is null) <> (nullif(trim(guest_name), '') is null))
);
create unique index if not exists trip_people_member_uq on public.trip_people (trip_id, user_id) where user_id is not null;
create index if not exists trip_people_trip_idx on public.trip_people (trip_id);

-- 8d. Album: túraképek rövid memóval
create table if not exists public.trip_photos (
  id          uuid primary key default gen_random_uuid(),
  trip_id     uuid not null references public.trips(id) on delete cascade,
  user_id     uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  path        text not null,
  memo        text,
  created_at  timestamptz not null default now()
);
create index if not exists trip_photos_trip_idx on public.trip_photos (trip_id);

-- 8e. Beszámolók a nap eseményeiről
create table if not exists public.trip_posts (
  id          uuid primary key default gen_random_uuid(),
  trip_id     uuid not null references public.trips(id) on delete cascade,
  user_id     uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  body        text not null check (length(trim(body)) > 0),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz
);
create index if not exists trip_posts_trip_idx on public.trip_posts (trip_id);

-- 8f. Kézi hozzárendelés: fogás berakása (true) vagy kivétele (false) egy túrából.
-- Ahol nincs sor, ott az automatikus szabály dönt (időszak + vízterület).
create table if not exists public.trip_catch_links (
  trip_id     uuid not null references public.trips(id) on delete cascade,
  client_id   uuid not null references public.catches(client_id) on delete cascade,
  included    boolean not null,
  set_by      uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  primary key (trip_id, client_id)
);

-- 8g. Jogosultságok
alter table public.trips            enable row level security;
alter table public.trip_people      enable row level security;
alter table public.trip_photos      enable row level security;
alter table public.trip_posts       enable row level security;
alter table public.trip_catch_links enable row level security;

revoke all on public.trips, public.trip_people, public.trip_photos, public.trip_posts, public.trip_catch_links from anon, authenticated;
grant select, insert, delete on public.trips to authenticated;
grant update (title, water, lat, lon, start_at, end_at, note, updated_at) on public.trips to authenticated;
grant select, insert, update, delete on public.trip_people, public.trip_catch_links to authenticated;
grant select, insert, delete on public.trip_photos to authenticated;
grant update (memo) on public.trip_photos to authenticated;
grant select, insert, delete on public.trip_posts to authenticated;
grant update (body, updated_at) on public.trip_posts to authenticated;

-- Túra: minden jóváhagyott tag lát és létrehozhat; módosítani, törölni a létrehozó és az admin tud
drop policy if exists "tura: jovahagyott olvassa" on public.trips;
create policy "tura: jovahagyott olvassa" on public.trips
  for select to authenticated using (public.is_approved());
drop policy if exists "tura: letrehozas" on public.trips;
create policy "tura: letrehozas" on public.trips
  for insert to authenticated with check (public.is_approved() and created_by = auth.uid());
drop policy if exists "tura: modositas" on public.trips;
create policy "tura: modositas" on public.trips
  for update to authenticated
  using (public.is_approved() and (created_by = auth.uid() or public.is_admin()))
  with check (public.is_approved() and (created_by = auth.uid() or public.is_admin()));
drop policy if exists "tura: torles" on public.trips;
create policy "tura: torles" on public.trips
  for delete to authenticated
  using (public.is_approved() and (created_by = auth.uid() or public.is_admin()));

-- Résztvevők és kézi hozzárendelés: a jóváhagyott tagok közösen kezelik
drop policy if exists "resztvevo: jovahagyott mindent" on public.trip_people;
create policy "resztvevo: jovahagyott mindent" on public.trip_people
  for all to authenticated using (public.is_approved()) with check (public.is_approved());
drop policy if exists "hozzarendeles: jovahagyott mindent" on public.trip_catch_links;
create policy "hozzarendeles: jovahagyott mindent" on public.trip_catch_links
  for all to authenticated using (public.is_approved()) with check (public.is_approved());

-- Album és beszámoló: mindenki lát és feltölthet; a sajátját (admin bárkiét) módosítja, törli
drop policy if exists "album: olvasas" on public.trip_photos;
create policy "album: olvasas" on public.trip_photos
  for select to authenticated using (public.is_approved());
drop policy if exists "album: feltoltes" on public.trip_photos;
create policy "album: feltoltes" on public.trip_photos
  for insert to authenticated with check (public.is_approved() and user_id = auth.uid());
drop policy if exists "album: modositas" on public.trip_photos;
create policy "album: modositas" on public.trip_photos
  for update to authenticated
  using (public.is_approved() and (user_id = auth.uid() or public.is_admin()))
  with check (public.is_approved() and (user_id = auth.uid() or public.is_admin()));
drop policy if exists "album: torles" on public.trip_photos;
create policy "album: torles" on public.trip_photos
  for delete to authenticated
  using (public.is_approved() and (user_id = auth.uid() or public.is_admin()));

drop policy if exists "beszamolo: olvasas" on public.trip_posts;
create policy "beszamolo: olvasas" on public.trip_posts
  for select to authenticated using (public.is_approved());
drop policy if exists "beszamolo: iras" on public.trip_posts;
create policy "beszamolo: iras" on public.trip_posts
  for insert to authenticated with check (public.is_approved() and user_id = auth.uid());
drop policy if exists "beszamolo: modositas" on public.trip_posts;
create policy "beszamolo: modositas" on public.trip_posts
  for update to authenticated
  using (public.is_approved() and (user_id = auth.uid() or public.is_admin()))
  with check (public.is_approved() and (user_id = auth.uid() or public.is_admin()));
drop policy if exists "beszamolo: torles" on public.trip_posts;
create policy "beszamolo: torles" on public.trip_posts
  for delete to authenticated
  using (public.is_approved() and (user_id = auth.uid() or public.is_admin()));

-- =====================================================================
-- KÉSZ. Sikeres futás után: „Success. No rows returned”.
-- =====================================================================
