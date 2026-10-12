# Horgásznapló

Baráti társaság horgászfogásainak nyilvántartása – telepíthető webes app (PWA) Android és iPhone telefonra.

- Fogásonként legfeljebb 6 fotó választható listaképpel, galéria nézet
- Push-értesítés új fogásról, megosztás Viber- / WhatsApp-csoportba
- Fogáshely (GPS, térkép vagy korábbi helyek), automatikus időjárás (Open-Meteo) és holdfázis a fogás időpontjára
- Mentett fogás szerkesztése (saját; admin: bárkié), e-mailes jelszó-visszaállítás
- Offline rögzítés, automatikus feltöltés a kapcsolat helyreállásakor
- Napló szűrőkkel, összesítők (horgászonként, vízterületenként, halfajonként, rekordok, havonta)
- Excel-kompatibilis CSV-export
- Egyéni belépés, admin általi tagjóváhagyás

## Fájlok

| Fájl | Szerep |
|---|---|
| `index.html`, `style.css`, `app.js` | Az app felülete és működése |
| `config.js` | **Ide kell beírni a Supabase URL-t és kulcsot** |
| `supabase.js` | Supabase kliens könyvtár (v2.117.3) |
| `sw.js`, `manifest.webmanifest`, `icons/` | Telepíthetőség és offline működés |
| `supabase_beallitas.sql` | Az adatbázis egyszeri beállítása új telepítésnél (Supabase SQL Editor) |
| `supabase_frissites_v2.sql` | Frissítés az 1. verzióról a 2.-ra (Supabase SQL Editor) |
| `supabase_frissites_v3.sql` | Frissítés a 2. verzióról a 3.-ra (Supabase SQL Editor) |
| `supabase/functions/ertesites/index.ts` | Push-értesítő szolgáltatás (Supabase Edge Function, neve: `ertesites`) |
| `vendor/leaflet/` | Térkép könyvtár (Leaflet 1.9.4); térképadatok: © OpenStreetMap közreműködők |

Az üzembe helyezés lépéseit a külön útmutató tartalmazza.

Időjárási adatok: [Open-Meteo.com](https://open-meteo.com/) (CC BY 4.0). Térkép: © [OpenStreetMap](https://www.openstreetmap.org/copyright) közreműködők.
