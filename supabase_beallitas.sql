-- =====================================================================
-- Horgásznapló – Supabase adatbázis beállítás
-- Futtatás: Supabase → SQL Editor → New query → a teljes szöveg
-- bemásolása → Run. Egyszer kell lefuttatni.
-- =====================================================================

-- 1. Tagok (profilok) -------------------------------------------------
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  approved     boolean not null default false,  -- az admin hagyja jóvá
  is_admin     boolean not null default false,
  created_at   timestamptz not null default now()
);

-- Új regisztrációnál automatikusan létrejön a profil (jóváhagyás nélkül)
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(nullif(trim(new.raw_user_meta_data->>'display_name'), ''), split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Jóváhagyott tag-e a bejelentkezett felhasználó?
create or replace function public.is_approved()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select approved from public.profiles where id = auth.uid()), false);
$$;

-- 2. Fogások ----------------------------------------------------------
create table if not exists public.catches (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null unique,              -- offline duplikáció elleni védelem
  user_id     uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  caught_at   timestamptz not null,
  species     text not null,
  weight_kg   numeric(6,3),
  length_cm   numeric(6,1),
  water       text not null,                     -- vízterület
  spot        text,                              -- helyszín / állás
  bait        text,
  method      text,
  released    boolean not null default false,    -- visszaengedve
  note        text,
  lat         double precision,
  lon         double precision,
  accuracy_m  double precision,
  photo_path  text,
  weather     jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists catches_caught_at_idx on public.catches (caught_at desc);
create index if not exists catches_user_idx      on public.catches (user_id);
create index if not exists catches_water_idx     on public.catches (water);

-- 3. Jogosultságok (Row Level Security) -------------------------------
alter table public.profiles enable row level security;
alter table public.catches  enable row level security;

revoke all on public.profiles from anon, authenticated;
revoke all on public.catches  from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (display_name) on public.profiles to authenticated;  -- magát jóváhagyni nem tudja
grant select, insert, update, delete on public.catches to authenticated;

drop policy if exists "profil: sajat vagy jovahagyott olvashatja" on public.profiles;
create policy "profil: sajat vagy jovahagyott olvashatja" on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.is_approved());

drop policy if exists "profil: sajat nev modositasa" on public.profiles;
create policy "profil: sajat nev modositasa" on public.profiles
  for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists "fogas: jovahagyott tagok olvassak" on public.catches;
create policy "fogas: jovahagyott tagok olvassak" on public.catches
  for select to authenticated
  using (public.is_approved());

drop policy if exists "fogas: sajat rogzitese" on public.catches;
create policy "fogas: sajat rogzitese" on public.catches
  for insert to authenticated
  with check (public.is_approved() and user_id = auth.uid());

drop policy if exists "fogas: sajat modositasa" on public.catches;
create policy "fogas: sajat modositasa" on public.catches
  for update to authenticated
  using (public.is_approved() and user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "fogas: sajat torlese" on public.catches;
create policy "fogas: sajat torlese" on public.catches
  for delete to authenticated
  using (public.is_approved() and user_id = auth.uid());

-- 4. Fotótár ------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('photos', 'photos', false)
on conflict (id) do nothing;

drop policy if exists "foto: jovahagyott tagok nezik" on storage.objects;
create policy "foto: jovahagyott tagok nezik" on storage.objects
  for select to authenticated
  using (bucket_id = 'photos' and public.is_approved());

drop policy if exists "foto: sajat feltoltes" on storage.objects;
create policy "foto: sajat feltoltes" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'photos' and public.is_approved()
              and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "foto: sajat felulirasa" on storage.objects;
create policy "foto: sajat felulirasa" on storage.objects
  for update to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "foto: sajat torlese" on storage.objects;
create policy "foto: sajat torlese" on storage.objects
  for delete to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);

-- 5. Tagok jóváhagyása az appból (csak admin) ---------------------------
create or replace function public.set_member_approval(member uuid, ok boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not coalesce((select is_admin and approved from public.profiles where id = auth.uid()), false) then
    raise exception 'Csak adminisztrátor hagyhat jóvá tagot.';
  end if;
  if member = auth.uid() and not ok then
    raise exception 'Saját magadat nem tilthatod le.';
  end if;
  update public.profiles set approved = ok where id = member;
end;
$$;

revoke all on function public.set_member_approval(uuid, boolean) from public, anon;
grant execute on function public.set_member_approval(uuid, boolean) to authenticated;

-- Az admin a jóváhagyásra váró tagokat is lássa
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select is_admin and approved from public.profiles where id = auth.uid()), false);
$$;

drop policy if exists "profil: admin mindent lat" on public.profiles;
create policy "profil: admin mindent lat" on public.profiles
  for select to authenticated
  using (public.is_admin());

-- =====================================================================
-- KÉSZ. Az első regisztráció után az admin jóváhagyása (SQL Editor):
--   update public.profiles set approved = true, is_admin = true
--   where id = (select id from auth.users where email = 'ADMIN@EMAIL.HU');
-- További tagok jóváhagyása: Table Editor → profiles → approved = true
-- =====================================================================
