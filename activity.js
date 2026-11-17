/* =====================================================================
   Horgásznapló – Tagok aktivitása (9.0 verzió)
   - Amíg az app nyitva és előtérben van, kb. 2 percenként jelez a szervernek
     (touch_active; a szerver 30 mp-en belül nem ír újra)
   - Az admin a Tagok listában látja: 🟢 „Most aktív” (5 percen belül) vagy
     „Utoljára aktív: …”. A tagok egymásét nem látják (adatbázis-szinten védve).
   Az app.js hívja meg: window.TFTActivity(api)
   ===================================================================== */
window.TFTActivity = function (A) {
  "use strict";
  const { state, esc, tzParts } = A;
  const BEAT_MS = 120000;      // jelzés gyakorisága
  const LIVE_MS = 5 * 60000;   // ennyin belül „Most aktív”
  const MIN_GAP = 60000;       // két jelzés között legalább ennyi (fókuszváltáskor se pörögjön)
  let last = 0, busy = false;
  const map = new Map();       // user_id → last_active_at (csak adminnál töltődik)
  let ok = true;               // false: a 9.0-s adatbázis-frissítés még nem futott le

  const isAdmin = () => !!(state.me && state.me.is_admin && state.me.role !== "viewer");
  const canBeat = () => !!(state.sb && state.uid && state.me && state.me.approved && navigator.onLine && document.visibilityState === "visible");

  async function touch(force) {
    if (!canBeat() || busy || !ok) return;
    if (!force && Date.now() - last < MIN_GAP) return;
    busy = true;
    try {
      const { error } = await state.sb.rpc("touch_active");
      if (error) throw error;
      last = Date.now();
    } catch (e) {
      // Hiányzó függvény (SQL nem futott le): csendben kikapcsol
      if (e && /touch_active|function|42883|PGRST202/i.test(String(e.message || e.code || e))) ok = false;
    } finally { busy = false; }
  }
  setInterval(() => touch(false), BEAT_MS);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") touch(false); });

  // Admin: az összes tag aktivitása
  async function load() {
    map.clear();
    if (!isAdmin() || !state.sb) return false;
    try {
      const { data, error } = await state.sb.from("member_activity").select("user_id, last_active_at");
      if (error) throw error;
      (data || []).forEach((r) => map.set(r.user_id, r.last_active_at));
      return true;
    } catch (_) { return false; }
  }

  function relText(iso, now) {
    const t = new Date(iso).getTime();
    const n = now || Date.now();
    const p = tzParts(new Date(t)), q = tzParts(new Date(n));
    const dayNo = (x) => Date.UTC(Number(x.y), Number(x.m) - 1, Number(x.d)) / 86400000;
    const dd = dayNo(q) - dayNo(p);
    const hm = `${p.h}:${p.min}`;
    if (dd <= 0) return `ma ${hm}`;
    if (dd === 1) return `tegnap ${hm}`;
    if (dd < 7) return `${dd} napja`;
    if (dd < 60) return `${Math.floor(dd / 7)} hete`;
    return `${p.y}. ${p.m}. ${p.d}.`;
  }

  // A Tagok listában a név alatt (csak admin, csak ha van adat)
  function html(uid, now) {
    if (!isAdmin()) return "";
    const iso = map.get(uid);
    const n = now || Date.now();
    if (!iso) return map.size ? `<small class="act act-none">Még nincs rögzített aktivitás</small>` : "";
    const live = n - new Date(iso).getTime() < LIVE_MS;
    return live ? `<small class="act act-live"><span class="act-dot" aria-hidden="true"></span>Most aktív</small>`
      : `<small class="act">Utoljára aktív: ${esc(relText(iso, n))}</small>`;
  }

  return { touch, load, html, relText, _map: map };
};
