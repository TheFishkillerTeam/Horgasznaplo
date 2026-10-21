/* =====================================================================
   Horgásznapló – Újdonságok jelölése (7. verzió)
   Felhasználónként és részenként (napló, galéria, túra részei) tárolja,
   mikor nézte meg utoljára; az azóta mások által hozzáadott vagy módosított
   elemek „új”-nak számítanak. A „látta” időpont a szerveren tárolódik
   (seen_marks tábla), így minden eszközön egyezik.
   Az app.js hívja meg: window.TFTNews(api)
   ===================================================================== */
window.TFTNews = function (A) {
  "use strict";
  const { state, idb } = A;

  const N = {
    marks: {},         // kulcs → ISO időpont (szerveridő)
    ok: false,         // a 7. verziós adatbázis-frissítés lefutott, és van kiinduló időpont
    pending: {},       // offline jelölések, a következő kapcsolatnál küldjük
    snap: {}           // megnyitott rész: a megnyitás előtti időpont (az „ÚJ” címkékhez)
  };
  const ms = (iso) => (iso ? new Date(iso).getTime() : NaN);

  async function loadCache() {
    const c = await idb.get("kv", "seen").catch(() => null);
    if (c && c.uid === state.uid) { N.marks = c.marks || {}; N.pending = c.pending || {}; N.ok = !!N.marks.base; }
  }
  const saveCache = () => idb.put("kv", { uid: state.uid, marks: N.marks, pending: N.pending }, "seen").catch(() => {});

  async function load() {
    if (!navigator.onLine || !state.sb || !state.uid) return;
    try {
      await flush();
      const { data, error } = await state.sb.from("seen_marks").select("key, seen_at");
      if (error) throw error;
      const m = {};
      (data || []).forEach((r) => { m[r.key] = r.seen_at; });
      // Offline készült, még el nem küldött jelölések felülírják a régebbieket
      Object.keys(N.pending).forEach((k) => { if (!m[k] || ms(N.pending[k]) > ms(m[k])) m[k] = N.pending[k]; });
      if (!m.base) {
        // Első indulás a 7. verzióval: innentől számít az újdonság (a régi elemek nem „újak”)
        const at = await rpcMark(["base"]);
        if (at) m.base = at;
      }
      N.marks = m;
      N.ok = !!m.base;
      // A most nyitva lévő részben megjelenő új elemeket a felhasználó látja → megtekintettnek számít
      const open = Object.keys(N.snap);
      if (N.ok && open.length) {
        const at = await rpcMark(open).catch(() => null);
        if (at) open.forEach((k) => { N.marks[k] = at; });
      }
      saveCache();
    } catch (e) {
      // A seen_marks tábla még nincs meg (az SQL-frissítés kimaradt): jelölés nélkül működik tovább
      N.ok = false;
      console.warn("Újdonságok betöltése sikertelen:", e && e.message);
    }
  }

  async function rpcMark(keys) {
    const { data, error } = await state.sb.rpc("mark_seen", { keys });
    if (error) throw error;
    return data;
  }

  async function flush() {
    const keys = Object.keys(N.pending);
    if (!keys.length) return;
    const at = await rpcMark(keys);
    keys.forEach((k) => { N.marks[k] = at; delete N.pending[k]; });
    saveCache();
  }

  // Az utolsó megtekintés ideje (a kiinduló időpont, ha a részt még nem nyitotta meg)
  const sinceReal = (key) => N.marks[key] || N.marks.base || null;
  const since = (key) => (key in N.snap ? N.snap[key] : sinceReal(key));

  // Új-e: mások által, a rész utolsó megtekintése után keletkezett vagy módosított elem.
  // live = true: a tényleges állapot (darabszámokhoz); különben a megnyitás előtti (címkékhez).
  function isNew(ts, key, author, live) {
    if (!N.ok || !ts || (author && author === state.uid)) return false;
    const s = live ? sinceReal(key) : since(key);
    return !!s && ms(ts) > ms(s);
  }
  const latest = (...ts) => ts.filter(Boolean).sort((a, b) => ms(b) - ms(a))[0] || null;

  // Egy rész megnyitása: a címkékhez megjegyezzük a régi időpontot, a jelölést pedig mentjük
  function enter(keys) {
    if (!N.ok) return;
    const list = [].concat(keys).filter((k) => !(k in N.snap));
    if (!list.length) return;
    const now = new Date().toISOString();
    list.forEach((k) => { N.snap[k] = sinceReal(k); N.marks[k] = now; N.pending[k] = now; });
    saveCache();
    if (navigator.onLine && state.sb) flush().catch(() => { /* később újra */ });
  }
  // Kilépés a részből: a következő megnyitásig a címkék eltűnnek
  function leave(prefix) {
    Object.keys(N.snap).forEach((k) => { if (!prefix || k === prefix || k.startsWith(prefix)) delete N.snap[k]; });
  }

  function reset() { N.marks = {}; N.pending = {}; N.snap = {}; N.ok = false; }

  return { load, loadCache, isNew, latest, enter, leave, reset, ok: () => N.ok, _: N };
};
