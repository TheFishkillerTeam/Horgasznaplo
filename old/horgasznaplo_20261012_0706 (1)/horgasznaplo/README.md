# Horgásznapló

Baráti társaság horgászfogásainak nyilvántartása – telepíthető webes app (PWA) Android és iPhone telefonra.

- Fotó, GPS-pozíció, automatikus időjárás (Open-Meteo)
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
| `supabase_beallitas.sql` | Az adatbázis egyszeri beállítása (Supabase SQL Editor) |

Az üzembe helyezés lépéseit a külön útmutató tartalmazza.

Időjárási adatok: [Open-Meteo.com](https://open-meteo.com/) (CC BY 4.0).
