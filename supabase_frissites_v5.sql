-- =====================================================================
-- Horgásznapló – adatbázis-frissítés az 5. verzióra
-- Túra borítókép, a túraképek készítési ideje (időrendi album)
-- Futtatás: Supabase → SQL Editor → a teljes szöveg bemásolása → Run.
-- Feltétel: a 4. verziós frissítés (supabase_frissites_v4.sql) már lefutott.
-- =====================================================================

-- 9a. A túra borítóképe (a túralistában jelenik meg)
alter table public.trips add column if not exists cover_path text;
grant update (cover_path) on public.trips to authenticated;

-- 9b. A túrakép készítési ideje (a fotó adataiból), az album időrendjéhez
alter table public.trip_photos add column if not exists taken_at timestamptz;

-- =====================================================================
-- KÉSZ. Sikeres futás után: „Success. No rows returned”.
-- =====================================================================
