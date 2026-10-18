-- =====================================================================
-- Horgásznapló – adatbázis-frissítés a 3. verzióhoz
-- (több fotó fogásonként, push-értesítés)
-- Futtatás: Supabase → SQL Editor → New query → a teljes szöveg
-- bemásolása → Run. Egyszer kell lefuttatni; többszöri futtatás sem árt.
-- FONTOS: a másolásnál az első sor is kerüljön át (két kötőjellel kezdődik)!
-- =====================================================================

-- 1. Több fotó fogásonként (a photo_path marad a listakép)
alter table public.catches add column if not exists photos text[];
update public.catches set photos = array[photo_path]
  where photo_path is not null and (photos is null or cardinality(photos) = 0);

-- 2. Értesítés nyilvántartása (egy fogásról csak egyszer megy értesítés)
alter table public.catches add column if not exists notified_at timestamptz;
-- A frissítés előtt rögzített fogásokról ne menjen utólag értesítés
update public.catches set notified_at = coalesce(notified_at, created_at) where notified_at is null;

-- 3. Push-feliratkozások (készülékenként egy sor)
create table if not exists public.push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  user_agent  text,
  created_at  timestamptz not null default now()
);
alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from anon, authenticated;
grant select, delete on public.push_subscriptions to authenticated;

drop policy if exists "push: sajat olvasasa" on public.push_subscriptions;
create policy "push: sajat olvasasa" on public.push_subscriptions
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "push: sajat torlese" on public.push_subscriptions;
create policy "push: sajat torlese" on public.push_subscriptions
  for delete to authenticated using (user_id = auth.uid());

-- 4. Szerveroldali titkok (a push-kulcspár); csak az Edge Function éri el
create table if not exists public.app_secrets (
  key    text primary key,
  value  jsonb not null
);
alter table public.app_secrets enable row level security;
revoke all on public.app_secrets from anon, authenticated;

-- KÉSZ. Sikeres futás után: "Success. No rows returned"
