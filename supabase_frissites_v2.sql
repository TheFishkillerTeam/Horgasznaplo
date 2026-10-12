-- =====================================================================
-- Horgásznapló – adatbázis-frissítés a 2. verzióhoz
-- (fogások szerkesztése, admin javítási joga)
-- Futtatás: Supabase → SQL Editor → New query → a teljes szöveg
-- bemásolása → Run. Egyszer kell lefuttatni; többszöri futtatás sem árt.
-- =====================================================================

-- 1. Módosítás nyilvántartása
alter table public.catches add column if not exists updated_at timestamptz;
alter table public.catches add column if not exists updated_by uuid references public.profiles(id) on delete set null;

-- 2. Az admin bárki fogását javíthatja és törölheti
drop policy if exists "fogas: admin modosithat" on public.catches;
create policy "fogas: admin modosithat" on public.catches
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "fogas: admin torolhet" on public.catches;
create policy "fogas: admin torolhet" on public.catches
  for delete to authenticated
  using (public.is_admin());

-- 3. Az admin bárki fogásához cserélhet vagy törölhet fotót
drop policy if exists "foto: admin feltolthet" on storage.objects;
create policy "foto: admin feltolthet" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'photos' and public.is_admin());

drop policy if exists "foto: admin felulirhat" on storage.objects;
create policy "foto: admin felulirhat" on storage.objects
  for update to authenticated
  using (bucket_id = 'photos' and public.is_admin());

drop policy if exists "foto: admin torolhet" on storage.objects;
create policy "foto: admin torolhet" on storage.objects
  for delete to authenticated
  using (bucket_id = 'photos' and public.is_admin());

-- KÉSZ. Sikeres futás után: "Success. No rows returned"
