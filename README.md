# Horgásznapló – 8.0

Baráti társaság horgászfogásainak nyilvántartása – telepíthető webes app (PWA) Android és iPhone telefonra.

- Kezdőlap vezérlőfelülettel; túrakereső (leírás, beszámoló, képaláírás, vendég); kétszintű, időrendi túraalbum; túraborító
- Horgásztúra napló: tervezett túra jelentkezéssel, résztvevők és vendégek, automatikus fogás-hozzárendelés (időszak + vízterület), album memóval, beszámolók, időjárás-trend grafikonnal, térkép
- Fogásonként legfeljebb 6 fotó választható listaképpel, galéria nézet
- Push-értesítés új fogásról, megosztás Viber- / WhatsApp-csoportba
- Fogáshely (GPS, térkép vagy korábbi helyek), automatikus időjárás (Open-Meteo) és holdfázis a fogás időpontjára
- Mentett fogás szerkesztése (saját; admin: bárkié), e-mailes jelszó-visszaállítás
- Offline rögzítés, automatikus feltöltés a kapcsolat helyreállásakor
- Rekordlisták: rangsor súly szerint fajonként és horgászonként darabszám szerint, keresztszűréssel (halfaj, víz, horgász, év, hónap/évszak, túra)
- Napló szűrőkkel, összesítők (horgászonként, vízterületenként, halfajonként, rekordok, havonta)
- Excel-kompatibilis CSV-export
- Egyéni belépés, admin általi tagjóváhagyás
- Karakterszámláló a korlátos szövegmezőknél (beszámoló, leírás, megjegyzés, memó)
- Újdonságok jelölése: a legutóbbi megnyitás óta mások által hozzáadott vagy módosított fogások, túrák, beszámolók, fotók, jelentkezések (minden eszközön egyező állapot)
- Elküldött meghívók listája: beváltva / függőben / lejárt / visszavont, visszavonás és link-újraküldés
- Visszaszámláló a tervezett túra indulásáig (kezdőlap Túrák csempéje, túralista)
- Lejárt nézelődők és meghívók alapból rejtve, egy gombbal megjeleníthetők
- Napi idézet a kezdőlapon (a teljes lista csak az adminnak látható és szerkeszthető)
- Túra tabella (összesítő, egyedi súlyok, rangsor halfajonként, napi bontás); Összesítők: horgász × halfaj, holdfázis / légnyomás / napszak / hőmérséklet / szél halfaj-szűrővel, évértékelő
- Egyéni csúcs jelzése; admin: teljes mentés JSON-ba, tárhelyfigyelés
- Születésnap, névnap, ünnepek (karácsony, újév, húsvét, halloween): felugró köszöntés animált grafikával, reggel 8-as értesítés; „Ma volt…” évfordulós emlékek; idézet-kör követése; „Telepítés alkalmazásként” gomb
- Nézelődők (korábban: családtagok): meghívás képernyőn megjelenő QR-kóddal vagy linkkel (e-mail, üzenet); tag 1 napra, admin tetszőleges időre vagy korlátlanul; a nézők csak megtekinthetnek, értesítést nem kapnak

## Fájlok

| Fájl | Szerep |
|---|---|
| `index.html`, `style.css`, `app.js` | Az app felülete és működése |
| `trips.js` | Horgásztúra napló |
| `records.js` | Rekordlisták |
| `family.js` | Nézelődők meghívása és hozzáférése |
| `news.js` | Újdonságok jelölése |
| `quotes.js` | Napi idézet, idézetek szerkesztése (admin) |
| `tally.js` | Tabella (túra és összesítő) |
| `admin.js` | Karbantartás: mentés, tárhelyfigyelés (admin) |
| `celebrate-core.js` | Ünnepek, emlékek számítása (az `ertesites` függvénnyel közös kód) |
| `celebrate.js` | Ünnepi felugró ablak, „Ma volt…”, születésnap / névnap megadása |
| `install.js` | „Telepítés alkalmazásként” gomb |
| `config.js` | **Ide kell beírni a Supabase URL-t és kulcsot** |
| `supabase.js` | Supabase kliens könyvtár (v2.117.3) |
| `sw.js`, `manifest.webmanifest`, `icons/` | Telepíthetőség és offline működés |
| `supabase_beallitas.sql` | Az adatbázis egyszeri beállítása új telepítésnél (Supabase SQL Editor) |
| `supabase_frissites_v2.sql` | Frissítés az 1. verzióról a 2.-ra (Supabase SQL Editor) |
| `supabase_frissites_v3.sql` | Frissítés a 2. verzióról a 3.-ra (Supabase SQL Editor) |
| `supabase_frissites_v5.sql` | Frissítés a 4. verzióról az 5.0-ra – borítókép, képek készítési ideje (Supabase SQL Editor) |
| `supabase_frissites_v4.sql` | Frissítés a 3. verzióról a 4.-re – túranapló (Supabase SQL Editor) |
| `supabase_frissites_v8.sql` | Frissítés a 7.5 verzióról a 8.0-ra (Supabase SQL Editor) |
| `supabase_idozito_v8.sql` | A reggel 8-as értesítés időzítője (a v8 SQL után) |
| `supabase_frissites_v7_5.sql` | Frissítés a 7.4 verzióról a 7.5-re – tárhelyfigyelés (Supabase SQL Editor) |
| `supabase_frissites_v7_4.sql` | Frissítés a 7.1–7.3 verzióról a 7.4-re – napi idézet, „nézelődő” elnevezés (Supabase SQL Editor) |
| `supabase_frissites_v7_1.sql` | Frissítés a 7.0 verzióról a 7.1-re – meghívó visszavonása (Supabase SQL Editor) |
| `supabase_frissites_v7.sql` | Frissítés a 6.x verzióról a 7.0-ra – újdonságok jelölése (Supabase SQL Editor) |
| `supabase_frissites_v6.sql` | Frissítés az 5.x verzióról a 6.0-ra – családtagok nézőként (Supabase SQL Editor) |
| `supabase/functions/ertesites/index.ts` | Push-értesítő szolgáltatás (Supabase Edge Function, neve: `ertesites`) |
| `vendor/qrcode/` | QR-kód készítő (qrcode-generator 1.4.4, MIT licenc) |
| `vendor/leaflet/` | Térkép könyvtár (Leaflet 1.9.4); térképadatok: © OpenStreetMap közreműködők |

Az üzembe helyezés lépéseit a külön útmutató tartalmazza.

Időjárási adatok: [Open-Meteo.com](https://open-meteo.com/) (CC BY 4.0). Térkép: © [OpenStreetMap](https://www.openstreetmap.org/copyright) közreműködők.
