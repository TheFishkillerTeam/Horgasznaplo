/* =====================================================================
   Horgásznapló – Horgásztúra napló (4. verzió)
   Túrák, résztvevők és jelentkezés, fogások automatikus hozzárendelése,
   album memóval, beszámolók, időjárás-trend és grafikon, térkép.
   Az app.js hívja meg: window.TFTTrips(api)
   ===================================================================== */
window.TFTTrips = function (A) {
  "use strict";
  const { state, $, esc, numFmt, dtFmt, tzParts, toast, errText, idb } = A;

  const T = {
    trips: [], people: [], photos: [], posts: [], links: [],
    missing: false,      // a 4. verziós adatbázis-frissítés még nem futott le
    loaded: false,
    view: "list",        // list | form | detail
    openId: null,
    sec: "overview",     // overview | catches | album | posts
    editId: null,        // szerkesztett túra (űrlap)
    loc: null,           // űrlap: a túra helye { lat, lon }
    queue: [],           // album: feltöltésre váró képek { blob, url }
    pickMode: false,     // fogások: kézi hozzáadás listája nyitva
    catchSort: "time",   // fogások: időrend | rangsor (súly szerint)
    editPost: null,
    wx: {},              // időjárás gyorsítótár
    map: null
  };

  const RSVP = { yes: "Jön", maybe: "Talán", no: "Nem jön" };
  const isAdmin = () => !!(state.me && state.me.is_admin);
  const canEditTrip = (t) => t && (t.created_by === state.uid || isAdmin());
  const own = (row) => row && (row.user_id === state.uid || isAdmin());
  const pad2 = (n) => String(n).padStart(2, "0");
  const ms = (iso) => new Date(iso).getTime();

  // ------------------------------------------------------------------
  // Adatok
  // ------------------------------------------------------------------
  const missingTable = (e) => e && (e.code === "42P01" || e.code === "PGRST205" ||
    /does not exist|Could not find the table/i.test((e.message || "") + (e.details || "")));

  async function fetchAll(table, orderCols) {
    const PAGE = 1000;
    let rows = [];
    for (let from = 0; ; from += PAGE) {
      let q = state.sb.from(table).select("*");
      orderCols.forEach((c) => { q = q.order(c); });
      const r = await q.range(from, from + PAGE - 1);
      if (r.error) throw r.error;
      rows = rows.concat(r.data || []);
      if (!r.data || r.data.length < PAGE) break;
    }
    return rows;
  }

  async function loadCache() {
    const c = await idb.get("kv", "trips").catch(() => null);
    if (c) Object.assign(T, { trips: c.trips || [], people: c.people || [], photos: c.photos || [], posts: c.posts || [], links: c.links || [] });
  }

  async function refresh() {
    if (!navigator.onLine || !state.sb) return;
    try {
      const [trips, people, photos, posts, links] = await Promise.all([
        fetchAll("trips", ["start_at", "id"]),
        fetchAll("trip_people", ["created_at", "id"]),
        fetchAll("trip_photos", ["created_at", "id"]),
        fetchAll("trip_posts", ["created_at", "id"]),
        fetchAll("trip_catch_links", ["created_at", "trip_id", "client_id"])
      ]);
      Object.assign(T, { trips, people, photos, posts, links, missing: false, loaded: true });
      await idb.put("kv", { trips, people, photos, posts, links }, "trips").catch(() => {});
    } catch (e) {
      if (missingTable(e)) T.missing = true;
      else console.warn("Túrák frissítése sikertelen:", e);
    }
    if (visible()) render();
  }

  const visible = () => !$("#tabTrips").classList.contains("hidden") && !$("#viewMain").classList.contains("hidden");
  const tripById = (id) => T.trips.find((t) => t.id === id);

  // ------------------------------------------------------------------
  // Fogások hozzárendelése: időszak + vízterület (automatikus), kézzel felülírható
  // ------------------------------------------------------------------
  const normWater = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ").trim();
  function waterMatch(a, b) {
    const x = normWater(a), y = normWater(b);
    if (!x || !y) return false;
    if (x === y) return true;
    // „Zagyva” túra ↔ „Zagyva, jászberényi szakasz” fogás (szóhatáron kezdődő egyezés)
    const pre = (long, short) => long.startsWith(short) && /[^a-z0-9]/.test(long.charAt(short.length));
    return pre(x, y) || pre(y, x);
  }
  function status(t, now = Date.now()) {
    if (now < ms(t.start_at)) return "planned";
    if (now <= ms(t.end_at)) return "active";
    return "past";
  }
  const linkOf = (tripId, cid) => T.links.find((l) => l.trip_id === tripId && l.client_id === cid);
  function autoIn(t, c) {
    const x = ms(c.caught_at);
    return x >= ms(t.start_at) && x <= ms(t.end_at) && waterMatch(c.water, t.water);
  }
  function inTrip(t, c) {
    if (c.trip_link === t.id) return true;              // még fel nem töltött fogás, túrából rögzítve
    const l = linkOf(t.id, c.client_id);
    return l ? !!l.included : autoIn(t, c);
  }
  const catchesOf = (t) => A.everyEntry().filter((c) => inTrip(t, c)).sort((a, b) => (a.caught_at < b.caught_at ? -1 : 1));
  const tripsOfCatch = (c) => T.trips.filter((t) => inTrip(t, c));

  // Résztvevők: a felvett sorok + akik fogást rögzítettek a túrán (automatikusan)
  function peopleOf(t) {
    const rows = T.people.filter((p) => p.trip_id === t.id).map((p) => Object.assign({}, p));
    catchesOf(t).forEach((c) => {
      if (c.guest_name) {
        if (!rows.some((p) => p.guest_name && normWater(p.guest_name) === normWater(c.guest_name)))
          rows.push({ id: null, trip_id: t.id, guest_name: c.guest_name, rsvp: "yes", derived: true });
      } else if (!rows.some((p) => p.user_id === c.user_id)) {
        rows.push({ id: null, trip_id: t.id, user_id: c.user_id, rsvp: "yes", derived: true });
      } else {
        const p = rows.find((r) => r.user_id === c.user_id);
        if (p.rsvp !== "yes") p.rsvp = "yes"; // aki fogott, az ott volt
      }
    });
    const label = (p) => (p.user_id ? A.nameOf(p.user_id) : p.guest_name);
    return rows.sort((a, b) => (a.guest_name ? 1 : 0) - (b.guest_name ? 1 : 0) || label(a).localeCompare(label(b), "hu"));
  }
  const guestsOf = (t) => peopleOf(t).filter((p) => p.guest_name && p.rsvp !== "no").map((p) => p.guest_name);

  // ------------------------------------------------------------------
  // Formázás
  // ------------------------------------------------------------------
  function rangeText(t) {
    const a = tzParts(new Date(t.start_at)), b = tzParts(new Date(t.end_at));
    const sameDay = a.y === b.y && a.m === b.m && a.d === b.d;
    const left = `${a.y}.${a.m}.${a.d}. ${a.h}:${a.min}`;
    if (sameDay) return `${left}–${b.h}:${b.min}`;
    return `${left} – ${a.y !== b.y ? b.y + "." : ""}${b.m}.${b.d}. ${b.h}:${b.min}`;
  }
  const statusBadge = (s) => ({
    planned: `<span class="tbadge planned">Tervezett</span>`,
    active: `<span class="tbadge active">Most zajlik</span>`,
    past: `<span class="tbadge past">Lezárult</span>`
  })[s];
  const kg = (v) => `${numFmt(v)} kg`;

  // ------------------------------------------------------------------
  // Megjelenítés
  // ------------------------------------------------------------------
  function render() {
    const box = $("#tripsOut");
    if (!box) return;
    if (T.map) { try { T.map.remove(); } catch (_) { /* már törölve */ } T.map = null; }
    if (T.view === "form") return renderForm(box);
    if (T.view === "detail" && tripById(T.openId)) return renderDetail(box);
    T.view = "list";
    renderList(box);
  }

  function missingHtml() {
    return `<div class="card warn-card"><strong>Az adatbázis-frissítés még hiányzik</strong>
      <p class="hint">A túranaplóhoz az adminisztrátornak le kell futtatnia a <code>supabase_frissites_v4.sql</code> fájlt a Supabase SQL Editorban (útmutató 14. fejezet).</p></div>`;
  }

  function tripCardHtml(t) {
    const s = status(t);
    const cs = catchesOf(t);
    const scored = cs.filter((c) => !c.guest_name);
    const ppl = peopleOf(t);
    const yes = ppl.filter((p) => p.rsvp === "yes").length;
    const mine = T.people.find((p) => p.trip_id === t.id && p.user_id === state.uid);
    const nPh = T.photos.filter((p) => p.trip_id === t.id).length + cs.reduce((n, c) => n + A.photoCount(c), 0);
    const nPo = T.posts.filter((p) => p.trip_id === t.id).length;
    const sum = scored.reduce((n, c) => n + (c.weight_kg != null ? Number(c.weight_kg) : 0), 0);
    return `
      <button type="button" class="card trip-card" data-trip-open="${esc(t.id)}">
        <div class="trip-card-head"><span class="trip-title">${esc(t.title)}</span>${statusBadge(s)}</div>
        <div class="trip-sub">${esc(t.water)} · ${esc(rangeText(t))}</div>
        <div class="trip-stats">
          <span>🐟 ${scored.length}${sum ? ` · ${esc(kg(sum))}` : ""}</span>
          <span>👥 ${yes}</span><span>📷 ${nPh}</span><span>📝 ${nPo}</span>
          ${s !== "past" ? `<span class="trip-me">${mine ? "Te: " + esc(RSVP[mine.rsvp]) : "Még nem jelezted"}</span>` : ""}
        </div>
      </button>`;
  }

  function renderList(box) {
    const now = Date.now();
    const groups = { active: [], planned: [], past: [] };
    T.trips.forEach((t) => groups[status(t, now)].push(t));
    groups.planned.sort((a, b) => ms(a.start_at) - ms(b.start_at));
    groups.active.sort((a, b) => ms(a.start_at) - ms(b.start_at));
    groups.past.sort((a, b) => ms(b.start_at) - ms(a.start_at));
    const sec = (title, list) => (list.length ? `<h3 class="sec-title">${title}</h3>${list.map(tripCardHtml).join("")}` : "");
    box.innerHTML = `
      ${T.missing ? missingHtml() : ""}
      <div class="card trips-head">
        <div><strong>Horgásztúra napló</strong>
          <div class="hint">A túra ideje alatt, a túra vízterületén rögzített fogások automatikusan a túrához kerülnek.</div></div>
        <button type="button" class="btn primary small" data-trip-new ${T.missing ? "disabled" : ""}>＋ Új túra</button>
      </div>
      ${sec("Most zajlik", groups.active)}
      ${sec("Tervezett", groups.planned)}
      ${sec("Korábbi túrák", groups.past)}
      ${T.trips.length ? "" : `<div class="card empty">Még nincs túra. Az „Új túra” gombbal kiírhatod az elsőt – a tervezett túráról a többiek értesítést kapnak.</div>`}`;
  }

  // ---- Túra űrlap (új / szerkesztés) ----
  function fmtDate(d) { return `${d.getFullYear()}.${pad2(d.getMonth() + 1)}.${pad2(d.getDate())}`; }
  function fmtTime(d) { return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; }
  function parseDT(ds, ts) {
    const dm = String(ds).trim().match(/^(\d{4})[.\-\/ ]?(\d{1,2})[.\-\/ ]?(\d{1,2})\.?$/);
    const tm = String(ts).trim().match(/^(\d{1,2})[:.]?(\d{2})$/);
    if (!dm || !tm) return null;
    const y = +dm[1], mo = +dm[2], da = +dm[3], h = +tm[1], mi = +tm[2];
    const d = new Date(y, mo - 1, da, h, mi);
    if (d.getFullYear() !== y || d.getMonth() !== mo - 1 || d.getDate() !== da || h > 23 || mi > 59) return null;
    return d;
  }

  function openForm(id) {
    const t = id ? tripById(id) : null;
    T.view = "form"; T.editId = t ? t.id : null;
    T.loc = t && t.lat != null ? { lat: Number(t.lat), lon: Number(t.lon) } : null;
    render();
    window.scrollTo(0, 0);
  }

  function renderForm(box) {
    const t = T.editId ? tripById(T.editId) : null;
    let s, e;
    if (t) { s = new Date(t.start_at); e = new Date(t.end_at); }
    else {
      s = new Date(); s.setDate(s.getDate() + 1); s.setHours(6, 0, 0, 0);
      e = new Date(s); e.setHours(18, 0, 0, 0);
    }
    box.innerHTML = `
      <form class="card" id="tripForm" novalidate>
        <div class="form-head"><h2>${t ? "Túra szerkesztése" : "Új túra"}</h2>
          <button type="button" class="btn small" data-trip-cancel>Mégse</button></div>
        <label class="field">Megnevezés *
          <input name="title" maxlength="80" required placeholder="pl. Őszi pontyozás a Zagyván" value="${esc(t ? t.title : "")}">
        </label>
        <label class="field">Vízterület *
          <input name="water" list="waterList" maxlength="80" required placeholder="pl. Zagyva" value="${esc(t ? t.water : "")}">
        </label>
        <p class="hint">A túrához automatikusan azok a fogások kerülnek, amelyek az alábbi időszakban, ezen a vízterületen születtek. A „Zagyva” túrához a „Zagyva, jászberényi szakasz” fogás is odakerül.</p>
        <div class="field">Kezdés *
          <div class="row2 dt-row">
            <input name="sd" data-fmt="date" inputmode="numeric" placeholder="ÉÉÉÉ.HH.NN" maxlength="10" autocomplete="off" value="${fmtDate(s)}" aria-label="Kezdés dátuma">
            <input name="st" data-fmt="time" inputmode="numeric" placeholder="ÓÓ:PP" maxlength="5" autocomplete="off" value="${fmtTime(s)}" aria-label="Kezdés ideje">
          </div>
        </div>
        <div class="field">Befejezés *
          <div class="row2 dt-row">
            <input name="ed" data-fmt="date" inputmode="numeric" placeholder="ÉÉÉÉ.HH.NN" maxlength="10" autocomplete="off" value="${fmtDate(e)}" aria-label="Befejezés dátuma">
            <input name="et" data-fmt="time" inputmode="numeric" placeholder="ÓÓ:PP" maxlength="5" autocomplete="off" value="${fmtTime(e)}" aria-label="Befejezés ideje">
          </div>
          <div class="chips">
            <button type="button" class="chip" data-trip-chip="day">Egész nap</button>
            <button type="button" class="chip" data-trip-chip="+1">+1 nap a végéhez</button>
            <button type="button" class="chip" data-trip-chip="now">Kezdés most</button>
          </div>
        </div>
        <label class="field">Leírás, gyülekező, teendők
          <textarea name="note" rows="3" maxlength="1500">${esc(t ? t.note || "" : "")}</textarea>
        </label>
        <div class="gps">
          <strong>A túra helye</strong>
          <div class="hint" id="tripLocStatus"></div>
          <div class="loc-actions">
            <button type="button" class="btn small" data-trip-loc="gps">📍 Jelenlegi helyem</button>
            <button type="button" class="btn small" data-trip-loc="map">🗺 Térképen</button>
            <button type="button" class="btn small" data-trip-loc="clear">Törlés</button>
          </div>
          <label class="field loc-prev">Korábbi helyek
            <select id="tripPrevPlaces">${placeOptions()}</select>
          </label>
          <p class="hint">Az időjárási adatok ehhez a helyhez készülnek. Ha nincs megadva, az első helymeghatározással rögzített fogás helyét használom.</p>
        </div>
        <button class="btn primary block" type="submit">${t ? "Módosítás mentése" : "Túra létrehozása"}</button>
        ${t ? "" : `<p class="hint">Ha a túra még nem zárult le, a többi tag értesítést kap róla, és jelezheti, hogy jön-e.</p>`}
        <p class="msg" id="tripFormMsg" role="status"></p>
      </form>`;
    renderLoc();
  }

  function placeOptions() {
    const pl = state.places || [];
    return `<option value="">${pl.length ? "— válassz a korábbi fogáshelyek közül —" : "— még nincs korábbi fogáshely —"}</option>` +
      pl.map((p, i) => `<option value="${i}">${esc(p.water)}${p.spot ? " – " + esc(p.spot) : ""} (${p.n}×)</option>`).join("");
  }
  function renderLoc() {
    const el = $("#tripLocStatus");
    if (el) el.textContent = T.loc ? `${T.loc.lat.toFixed(5)}, ${T.loc.lon.toFixed(5)}` : "Nincs megadva.";
  }

  function onFormInput(e) {
    const el = e.target;
    if (el.dataset.fmt === "date") {
      let v = el.value.replace(/[^\d]/g, "").slice(0, 8);
      if (v.length > 6) v = `${v.slice(0, 4)}.${v.slice(4, 6)}.${v.slice(6)}`;
      else if (v.length > 4) v = `${v.slice(0, 4)}.${v.slice(4)}`;
      el.value = v;
      // Ha a kezdés a befejezés utánra került, a befejezés dátuma követi
      if (el.name === "sd" && v.length === 10) {
        const f = el.form, s = parseDT(f.sd.value, f.st.value), e = parseDT(f.ed.value, f.et.value);
        if (s && (!e || e <= s)) {
          const n = new Date(s); const [h, mi] = (f.et.value || "18:00").split(":").map(Number);
          n.setHours(h || 0, mi || 0, 0, 0);
          if (n <= s) n.setTime(s.getTime() + 12 * 3600000);
          f.ed.value = fmtDate(n); f.et.value = fmtTime(n);
        }
      }
    } else if (el.dataset.fmt === "time") {
      let v = el.value.replace(/[^\d]/g, "").slice(0, 4);
      if (v.length > 2) v = `${v.slice(0, 2)}:${v.slice(2)}`;
      el.value = v;
    }
  }

  function formChip(code) {
    const f = $("#tripForm");
    const s = parseDT(f.sd.value, f.st.value) || new Date();
    if (code === "day") {
      const a = new Date(s); a.setHours(0, 0, 0, 0);
      const b = new Date(s); b.setHours(23, 59, 0, 0);
      f.sd.value = fmtDate(a); f.st.value = fmtTime(a); f.ed.value = fmtDate(b); f.et.value = fmtTime(b);
    } else if (code === "+1") {
      const e = parseDT(f.ed.value, f.et.value);
      const n = new Date((e && e > s ? e : s).getTime() + 86400000);
      f.ed.value = fmtDate(n); f.et.value = fmtTime(n);
    } else if (code === "now") {
      const n = new Date();
      f.sd.value = fmtDate(n); f.st.value = fmtTime(n);
    }
  }

  function formLoc(kind) {
    if (kind === "clear") { T.loc = null; renderLoc(); return; }
    if (kind === "gps") {
      if (!("geolocation" in navigator)) { toast("Ez a készülék nem támogatja a helymeghatározást."); return; }
      $("#tripLocStatus").textContent = "Pozíció keresése…";
      navigator.geolocation.getCurrentPosition(
        (p) => { T.loc = { lat: p.coords.latitude, lon: p.coords.longitude }; renderLoc(); },
        () => { renderLoc(); toast("Nem sikerült pozíciót kapni."); },
        { enableHighAccuracy: true, timeout: 20000, maximumAge: 60000 });
      return;
    }
    if (kind === "map") A.openMap({ center: T.loc, onPick: (lat, lon) => { T.loc = { lat, lon }; renderLoc(); } });
  }

  function formPlace(sel) {
    const p = (state.places || [])[Number(sel.value)];
    sel.value = "";
    if (!p) return;
    T.loc = { lat: p.lat, lon: p.lon };
    const f = $("#tripForm");
    if (p.water && !f.water.value.trim()) f.water.value = p.water;
    renderLoc();
  }

  async function saveForm(ev) {
    ev.preventDefault();
    const f = ev.target;
    const msg = $("#tripFormMsg");
    const fail = (m) => { msg.className = "msg err"; msg.textContent = m; };
    const title = f.title.value.trim(), water = f.water.value.trim();
    const s = parseDT(f.sd.value, f.st.value), e = parseDT(f.ed.value, f.et.value);
    if (!title || !water) return fail("A megnevezés és a vízterület kitöltése kötelező.");
    if (!s) return fail("A kezdést így add meg: ÉÉÉÉ.HH.NN és ÓÓ:PP.");
    if (!e) return fail("A befejezést így add meg: ÉÉÉÉ.HH.NN és ÓÓ:PP.");
    if (e <= s) return fail("A befejezés legyen későbbi, mint a kezdés.");
    if (e - s > 21 * 86400000) return fail("Egy túra legfeljebb 3 hét lehet.");
    if (!navigator.onLine) return fail("A túra mentéséhez internetkapcsolat kell.");
    const row = { title, water, start_at: s.toISOString(), end_at: e.toISOString(), note: f.note.value.trim() || null,
      lat: T.loc ? T.loc.lat : null, lon: T.loc ? T.loc.lon : null };
    const btn = f.querySelector("button[type=submit]");
    btn.disabled = true; msg.className = "msg"; msg.textContent = "Mentés…";
    try {
      if (T.editId) {
        row.updated_at = new Date().toISOString();
        const { data, error } = await state.sb.from("trips").update(row).eq("id", T.editId).select("id");
        if (error) throw error;
        if (!data || !data.length) throw new Error("Nincs jogosultságod a túra módosításához.");
        delete T.wx[T.editId];
        T.view = "detail"; T.openId = T.editId;
        toast("Túra módosítva.");
      } else {
        const { data, error } = await state.sb.from("trips").insert(row).select("*").maybeSingle();
        if (error) throw error;
        if (!data) throw new Error("A túra nem jött létre.");
        // A kiíró automatikusan résztvevő
        await state.sb.from("trip_people").insert({ trip_id: data.id, user_id: state.uid, rsvp: "yes" });
        if (ms(data.end_at) > Date.now()) A.callFn({ action: "new_trip", trip_id: data.id, url: A.APP_URL }).catch((x) => console.warn("Értesítés:", x));
        T.view = "detail"; T.openId = data.id; T.sec = "overview";
        toast(ms(data.end_at) > Date.now() ? "Túra létrehozva, a többiek értesítést kapnak." : "Túra létrehozva.");
      }
      await refresh();
      render();
      window.scrollTo(0, 0);
    } catch (x) {
      fail("A mentés nem sikerült: " + errText(x));
    } finally {
      btn.disabled = false;
    }
  }

  async function deleteTrip(id) {
    const t = tripById(id);
    if (!t || !confirm(`Biztosan törlöd a(z) „${t.title}” túrát? Az album képei és a beszámolók is törlődnek; a fogások megmaradnak.`)) return;
    if (!navigator.onLine) { toast("Törléshez internetkapcsolat kell."); return; }
    try {
      const paths = T.photos.filter((p) => p.trip_id === id).map((p) => p.path);
      const { data, error } = await state.sb.from("trips").delete().eq("id", id).select("id");
      if (error) throw error;
      if (!data || !data.length) throw new Error("Nincs jogosultságod a túra törléséhez.");
      if (paths.length) state.sb.storage.from("photos").remove(paths).catch(() => {});
      T.view = "list"; T.openId = null;
      toast("Túra törölve.");
      await refresh(); render();
    } catch (x) { toast("A törlés nem sikerült: " + errText(x)); }
  }

  // ---- Túra részletei ----
  function open(id, sec) {
    T.view = "detail"; T.openId = id; T.sec = sec || "overview"; T.pickMode = false; T.editPost = null;
    T.queue.forEach((q) => URL.revokeObjectURL(q.url)); T.queue = [];
    render();
    window.scrollTo(0, 0);
  }

  function renderDetail(box) {
    const t = tripById(T.openId);
    const s = status(t);
    const cs = catchesOf(t);
    const nPh = T.photos.filter((p) => p.trip_id === t.id).length + cs.reduce((n, c) => n + A.photoCount(c), 0);
    const nPo = T.posts.filter((p) => p.trip_id === t.id).length;
    const tab = (k, label) => `<button type="button" data-trip-sec="${k}" class="${T.sec === k ? "active" : ""}" aria-pressed="${T.sec === k}">${label}</button>`;
    box.innerHTML = `
      <div class="card trip-head">
        <button type="button" class="link" data-trip-back>‹ Túrák</button>
        <div class="trip-card-head"><h2 class="trip-h">${esc(t.title)}</h2>${statusBadge(s)}</div>
        <div class="trip-sub">${esc(t.water)} · ${esc(rangeText(t))}</div>
        <div class="hint">Kiírta: ${esc(A.nameOf(t.created_by))}${t.updated_at ? ` · módosítva: ${esc(dtFmt(t.updated_at))}` : ""}</div>
        ${canEditTrip(t) ? `<div class="catch-actions">
          <button type="button" class="link" data-trip-edit="${esc(t.id)}">Szerkesztés</button>
          <button type="button" class="link btn-danger-link" data-trip-del="${esc(t.id)}">Törlés</button></div>` : ""}
      </div>
      <div class="trip-tabs" role="group" aria-label="Túra részei">
        ${tab("overview", "Áttekintés")}${tab("catches", `Fogások (${cs.length})`)}${tab("album", `Album (${nPh})`)}${tab("posts", `Beszámolók (${nPo})`)}
      </div>
      <div id="tripSec"></div>`;
    const out = $("#tripSec");
    if (T.sec === "catches") renderCatches(out, t, cs);
    else if (T.sec === "album") renderAlbum(out, t, cs);
    else if (T.sec === "posts") renderPosts(out, t);
    else renderOverview(out, t, cs, s);
  }

  // ---- Áttekintés: leírás, jelentkezés, résztvevők, összegzés, időjárás, térkép ----
  function renderOverview(out, t, cs, s) {
    const ppl = peopleOf(t);
    const mine = T.people.find((p) => p.trip_id === t.id && p.user_id === state.uid);
    const scored = cs.filter((c) => !c.guest_name);
    const guests = cs.filter((c) => c.guest_name);
    const sum = scored.reduce((n, c) => n + (c.weight_kg != null ? Number(c.weight_kg) : 0), 0);
    const best = scored.reduce((b, c) => (c.weight_kg != null && (!b || Number(c.weight_kg) > Number(b.weight_kg)) ? c : b), null);
    const inList = new Set(ppl.filter((p) => p.user_id).map((p) => p.user_id));
    const addable = Object.values(state.profiles).filter((p) => p.approved && !inList.has(p.id))
      .sort((a, b) => (a.display_name || "").localeCompare(b.display_name || "", "hu"));
    const pRow = (p) => {
      const name = p.user_id ? A.nameOf(p.user_id) : p.guest_name;
      const tag = p.guest_name ? `<span class="tag">vendég</span>` : "";
      const st = s === "past" ? (p.derived ? `<small>fogás alapján</small>` : "") :
        `<span class="rsvp ${p.rsvp}">${RSVP[p.rsvp]}</span>`;
      return `<li class="person"><span>${esc(name)} ${tag}</span><span class="person-r">${st}
        ${p.id ? `<button type="button" class="x-btn" data-person-del="${esc(p.id)}" aria-label="${esc(name)} eltávolítása">✕</button>` : ""}</span></li>`;
    };
    const visiblePpl = s === "past" ? ppl.filter((p) => p.rsvp !== "no") : ppl;
    const yes = ppl.filter((p) => p.rsvp === "yes").length, maybe = ppl.filter((p) => p.rsvp === "maybe").length;
    out.innerHTML = `
      ${t.note ? `<div class="card"><div class="pre">${esc(t.note)}</div></div>` : ""}
      ${s !== "past" ? `<div class="card">
        <strong>Részt veszel?</strong>
        <div class="rsvp-btns" role="group" aria-label="Jelentkezés">
          ${["yes", "maybe", "no"].map((k) => `<button type="button" class="btn small${mine && mine.rsvp === k ? " primary" : ""}" data-rsvp="${k}" aria-pressed="${!!(mine && mine.rsvp === k)}">${k === "yes" ? "Jövök" : k === "maybe" ? "Talán" : "Nem jövök"}</button>`).join("")}
        </div></div>` : ""}
      <div class="card">
        <strong>Résztvevők</strong> <span class="hint">${s === "past" ? `${visiblePpl.length} fő` : `${yes} jön${maybe ? `, ${maybe} talán` : ""}`}</span>
        <ul class="people">${visiblePpl.map(pRow).join("") || `<li class="hint">Még nincs résztvevő.</li>`}</ul>
        <div class="add-row">
          <select id="addMember" aria-label="Tag hozzáadása"><option value="">— tag hozzáadása —</option>
            ${addable.map((p) => `<option value="${esc(p.id)}">${esc(p.display_name)}</option>`).join("")}</select>
          <button type="button" class="btn small" data-add-member>Hozzáad</button>
        </div>
        <div class="add-row">
          <input id="addGuest" maxlength="40" placeholder="Vendég neve (nem TFT-tag)" aria-label="Vendég neve">
          <button type="button" class="btn small" data-add-guest>Vendég</button>
        </div>
      </div>
      ${cs.length ? `<div class="card trip-sum">
        <div><b>${scored.length}</b> fogás${sum ? ` · <b>${esc(kg(sum))}</b> összesen` : ""}</div>
        ${best ? `<div>Legnagyobb: <b>${esc(best.species)} – ${esc(kg(best.weight_kg))}</b> (${esc(A.nameOf(best.user_id))})</div>` : ""}
        ${guests.length ? `<div class="hint">+ ${guests.length} vendégfogás (versenyen kívül)</div>` : ""}
      </div>` : ""}
      <div class="card" id="tripWx"><strong>${s === "planned" ? "Időjárás-előrejelzés" : "Időjárás a túra alatt"}</strong><p class="hint">Betöltés…</p></div>
      <div class="card" id="tripMapCard"><strong>Térkép</strong><div id="tripMap" class="trip-map"></div><p class="hint" id="tripMapHint"></p></div>`;
    loadWeather(t, cs, s);
    drawMap(t, cs);
  }

  async function setRsvp(k) {
    const t = tripById(T.openId);
    if (!navigator.onLine) { toast("A jelentkezéshez internetkapcsolat kell."); return; }
    try {
      const mine = T.people.find((p) => p.trip_id === t.id && p.user_id === state.uid);
      const r = mine
        ? await state.sb.from("trip_people").update({ rsvp: k }).eq("id", mine.id).select("id")
        : await state.sb.from("trip_people").insert({ trip_id: t.id, user_id: state.uid, rsvp: k }).select("id");
      if (r.error) throw r.error;
      toast(k === "yes" ? "Jelezted, hogy jössz." : k === "maybe" ? "Jelezted: talán." : "Jelezted, hogy nem jössz.");
      await refresh();
    } catch (x) { toast(errText(x)); }
  }

  async function addPerson(row) {
    if (!navigator.onLine) { toast("Ehhez internetkapcsolat kell."); return; }
    try {
      const { error } = await state.sb.from("trip_people").insert(Object.assign({ trip_id: T.openId, rsvp: "yes" }, row));
      if (error) throw error;
      await refresh();
    } catch (x) { toast(/duplicate|unique/i.test(errText(x)) ? "Már szerepel a listán." : errText(x)); }
  }
  async function delPerson(id) {
    const p = T.people.find((x) => x.id === id);
    if (!p || !confirm(`Eltávolítod a listáról: ${p.user_id ? A.nameOf(p.user_id) : p.guest_name}?`)) return;
    try {
      const { error } = await state.sb.from("trip_people").delete().eq("id", id);
      if (error) throw error;
      await refresh();
    } catch (x) { toast(errText(x)); }
  }

  // ---- Időjárás a túra időszakára (Open-Meteo, óránként) ----
  function tripPlace(t, cs) {
    if (t.lat != null && t.lon != null) return { lat: Number(t.lat), lon: Number(t.lon) };
    const c = cs.find((x) => x.lat != null && x.lon != null);
    return c ? { lat: Number(c.lat), lon: Number(c.lon), fromCatch: true } : null;
  }

  async function fetchRange(lat, lon, startMs, endMs) {
    const a = tzParts(new Date(startMs)), b = tzParts(new Date(endMs));
    const ageDays = (Date.now() - startMs) / 86400000;
    if ((startMs - Date.now()) / 86400000 > 15) throw new Error("Az előrejelzés legfeljebb 16 napra előre érhető el.");
    const base = ageDays > 80 ? "https://archive-api.open-meteo.com/v1/archive" : "https://api.open-meteo.com/v1/forecast";
    const params = new URLSearchParams({
      latitude: lat.toFixed(4), longitude: lon.toFixed(4),
      hourly: "temperature_2m,pressure_msl,wind_speed_10m,wind_direction_10m,precipitation,weather_code",
      timezone: A.TZ, wind_speed_unit: "kmh",
      start_date: `${a.y}-${a.m}-${a.d}`, end_date: `${b.y}-${b.m}-${b.d}`
    });
    const res = await fetch(`${base}?${params}`);
    if (!res.ok) throw new Error("Időjárás-lekérés hiba: " + res.status);
    const j = await res.json();
    const H = j.hourly;
    if (!H || !H.time) throw new Error("Nincs időjárási adat erre az időszakra.");
    const from = `${a.y}-${a.m}-${a.d}T${a.h}:00`, to = `${b.y}-${b.m}-${b.d}T${b.h}:00`;
    const rows = [];
    H.time.forEach((k, i) => {
      if (k < from || k > to) return;
      rows.push({ k, temp: H.temperature_2m[i], pres: H.pressure_msl[i], wind: H.wind_speed_10m[i], dir: H.wind_direction_10m[i],
        prec: H.precipitation ? H.precipitation[i] : null, code: H.weather_code ? H.weather_code[i] : null });
    });
    if (!rows.length) throw new Error("Nincs időjárási adat erre az időszakra.");
    return rows;
  }
  // Helyi idő szerinti órakulcs → időbélyeg (a grafikonhoz és a fogásjelölőkhöz)
  function keyToMs(k) {
    // A kulcs a beállított időzóna helyi ideje; a különbséget egy közeli időponthoz mért eltolással számoljuk
    const [d, h] = k.split("T");
    const [y, m, dd] = d.split("-").map(Number);
    const guess = Date.UTC(y, m - 1, dd, Number(h.slice(0, 2)), 0);
    const p = tzParts(new Date(guess));
    const shown = Date.UTC(Number(p.y), Number(p.m) - 1, Number(p.d), Number(p.h), Number(p.min));
    return guess - (shown - guess);
  }

  async function loadWeather(t, cs, s) {
    const box = $("#tripWx");
    const title = `<strong>${s === "planned" ? "Időjárás-előrejelzés" : "Időjárás a túra alatt"}</strong>`;
    const place = tripPlace(t, cs);
    if (!place) { box.innerHTML = `${title}<p class="hint">Add meg a túra helyét (Szerkesztés → A túra helye), vagy rögzíts helymeghatározással fogást, és megjelenik az időjárás.</p>`; return; }
    const startMs = ms(t.start_at);
    const endMs = s === "active" ? Math.min(ms(t.end_at), Date.now()) : ms(t.end_at);
    const key = `${t.id}|${place.lat.toFixed(3)}|${place.lon.toFixed(3)}|${t.start_at}|${t.end_at}|${s === "active" ? Math.floor(Date.now() / 3600000) : s}`;
    let rows = T.wx[key];
    try {
      if (!rows) {
        const stored = s === "past" && endMs < Date.now() - 6 * 86400000 ? await idb.get("kv", "wx:" + key).catch(() => null) : null;
        if (stored) rows = stored;
        else {
          if (!navigator.onLine) throw new Error("Az időjáráshoz internetkapcsolat kell.");
          rows = await fetchRange(place.lat, place.lon, startMs, endMs);
          if (s === "past" && endMs < Date.now() - 6 * 86400000) idb.put("kv", rows, "wx:" + key).catch(() => {});
        }
        T.wx[key] = rows;
      }
    } catch (x) {
      if ($("#tripWx") === box) box.innerHTML = `${title}<p class="hint">${esc(errText(x))}</p>`;
      return;
    }
    if (!document.body.contains(box)) return;
    const marks = cs.map((c) => ({ t: ms(c.caught_at), label: `${A.anglerOf(c)}: ${c.species}${c.weight_kg != null ? " " + kg(c.weight_kg) : ""}` }));
    box.innerHTML = `${title}
      ${place.fromCatch ? `<p class="hint">Hely: az első helymeghatározással rögzített fogás helye.</p>` : ""}
      <table class="trend">
        ${trendRow("Hőmérséklet", rows.map((r) => r.temp), "°C", 1, 1)}
        ${trendRow("Légnyomás", rows.map((r) => r.pres), "hPa", 0, 1)}
        ${trendRow("Szélsebesség", rows.map((r) => r.wind), "km/h", 0, 3)}
        ${dirRow(rows)}
        ${precRow(rows)}
      </table>
      <p class="hint trend-key"><span class="tr up">▲</span> emelkedik · <span class="tr down">▼</span> csökken · <span class="tr flat">→</span> lényegében változatlan (a kezdő és a záró óra értéke alapján)</p>
      <div class="wxcharts">
        <div class="wxchart" data-chart="pres"></div>
        <div class="wxchart" data-chart="temp"></div>
        <div class="wxchart" data-chart="wind"></div>
      </div>
      <p class="hint">A függőleges szaggatott vonalak a túra fogásai. Koppints a grafikonra az óránkénti értékért. Adatok: <a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo.com</a> (CC BY 4.0)${s === "planned" ? "; az előrejelzés változhat" : ""}.</p>`;
    const pts = (f) => rows.map((r) => ({ t: keyToMs(r.k), v: r[f] }));
    drawChart(box.querySelector('[data-chart="pres"]'), "Légnyomás (hPa)", pts("pres"), marks, 0, "hPa", 4);
    drawChart(box.querySelector('[data-chart="temp"]'), "Hőmérséklet (°C)", pts("temp"), marks, 1, "°C", 4);
    drawChart(box.querySelector('[data-chart="wind"]'), "Szélsebesség (km/h)", pts("wind"), marks, 0, "km/h", 10, true);
  }

  function trendRow(label, vals, unit, dec, flatTol) {
    const v = vals.filter((x) => x != null);
    if (!v.length) return "";
    const first = v[0], last = v[v.length - 1], d = last - first;
    const dir = Math.abs(d) < flatTol ? "flat" : d > 0 ? "up" : "down";
    const arrow = dir === "up" ? "▲" : dir === "down" ? "▼" : "→";
    const sign = d > 0 ? "+" : d < 0 ? "−" : "±";
    const min = Math.min(...v), max = Math.max(...v);
    return `<tr><th>${label}</th>
      <td>${numFmt(first, dec)} → ${numFmt(last, dec)} ${unit}<small class="mm">közben ${numFmt(min, dec)}–${numFmt(max, dec)}</small></td>
      <td><span class="tr ${dir}" title="${dir === "up" ? "emelkedik" : dir === "down" ? "csökken" : "változatlan"}">${arrow} ${sign}${numFmt(Math.abs(d), dec)}</span></td></tr>`;
  }
  function dirRow(rows) {
    const v = rows.filter((r) => r.dir != null);
    if (!v.length) return "";
    const a = A.windDir(v[0].dir), b = A.windDir(v[v.length - 1].dir);
    return `<tr><th>Szélirány</th><td>${esc(a)} → ${esc(b)}</td><td>${a === b ? `<span class="tr flat">→</span>` : `<span class="tr turn">↻ fordult</span>`}</td></tr>`;
  }
  function precRow(rows) {
    const sum = rows.reduce((n, r) => n + (r.prec || 0), 0);
    return `<tr><th>Csapadék</th><td>${sum ? `${numFmt(sum, 1)} mm összesen` : "nem volt"}</td><td></td></tr>`;
  }

  // Egyszerű, egysoros vonaldiagram (egy mérőszám, egy tengely), fogásjelölőkkel és koppintásra értékkel
  function drawChart(el, label, pts, marks, dec, unit, minSpan, zeroBase) {
    const W = Math.max(280, Math.round(el.clientWidth || 340)), H = 150;
    const pl = 40, pr = 8, pt = 12, pb = 22;
    const vs = pts.filter((p) => p.v != null).map((p) => p.v);
    if (vs.length < 2) { el.innerHTML = ""; return; }
    let lo = Math.min(...vs), hi = Math.max(...vs);
    if (zeroBase) lo = 0;
    if (hi - lo < minSpan) { const m = (hi + lo) / 2; lo = zeroBase ? 0 : m - minSpan / 2; hi = zeroBase ? Math.max(hi, minSpan) : m + minSpan / 2; }
    const t0 = pts[0].t, t1 = pts[pts.length - 1].t;
    const X = (t) => pl + (t - t0) / Math.max(1, t1 - t0) * (W - pl - pr);
    const Y = (v) => pt + (hi - v) / (hi - lo) * (H - pt - pb);
    let d = "", pen = false;
    pts.forEach((p) => { if (p.v == null) { pen = false; return; } d += `${pen ? "L" : "M"}${X(p.t).toFixed(1)},${Y(p.v).toFixed(1)}`; pen = true; });
    const ticks = [lo, (lo + hi) / 2, hi];
    const grid = ticks.map((v) => `<line x1="${pl}" x2="${W - pr}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}" class="g"/>
      <text x="${pl - 6}" y="${(Y(v) + 4).toFixed(1)}" text-anchor="end" class="ax">${numFmt(v, dec)}</text>`).join("");
    const spanH = (t1 - t0) / 3600000;
    const step = [1, 2, 3, 6, 12, 24, 48].find((s) => spanH / s <= 6) || 72;
    let xt = "";
    pts.forEach((p) => {
      const hh = Number(tzParts(new Date(p.t)).h);
      if (hh % step !== 0 && step < 24) return;
      if (step >= 24 && hh !== 0) return;
      const q = tzParts(new Date(p.t));
      const lab = hh === 0 ? `${q.m}.${q.d}.` : `${q.h}h`;
      xt += `<text x="${X(p.t).toFixed(1)}" y="${H - 6}" text-anchor="middle" class="ax">${lab}</text>`;
    });
    const mk = marks.filter((m) => m.t >= t0 && m.t <= t1).map((m) =>
      `<line x1="${X(m.t).toFixed(1)}" x2="${X(m.t).toFixed(1)}" y1="${pt}" y2="${H - pb}" class="mk"><title>${esc(m.label)}</title></line>
       <circle cx="${X(m.t).toFixed(1)}" cy="${pt}" r="4" class="mkd"><title>${esc(m.label)}</title></circle>`).join("");
    el.innerHTML = `<div class="wxchart-head"><span>${esc(label)}</span><span class="wx-tip" aria-live="polite"></span></div>
      <svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)} a túra alatt, ${numFmt(vs[0], dec)}-ról ${numFmt(vs[vs.length - 1], dec)} ${esc(unit)}-ra">
        ${grid}${xt}${mk}
        <path d="${d}" class="ln"/>
        <line class="xh hidden" y1="${pt}" y2="${H - pb}"/><circle class="xd hidden" r="4"/>
        <rect x="${pl}" y="0" width="${W - pl - pr}" height="${H}" fill="transparent" class="hit"/>
      </svg>`;
    const svg = el.querySelector("svg"), tip = el.querySelector(".wx-tip");
    const xh = svg.querySelector(".xh"), xd = svg.querySelector(".xd");
    const show = (ev) => {
      const r = svg.getBoundingClientRect();
      const x = (ev.clientX - r.left) * (W / r.width);
      let best = null;
      pts.forEach((p) => { if (p.v != null && (!best || Math.abs(X(p.t) - x) < Math.abs(X(best.t) - x))) best = p; });
      if (!best) return;
      const q = tzParts(new Date(best.t));
      xh.setAttribute("x1", X(best.t)); xh.setAttribute("x2", X(best.t)); xh.classList.remove("hidden");
      xd.setAttribute("cx", X(best.t)); xd.setAttribute("cy", Y(best.v)); xd.classList.remove("hidden");
      const near = marks.filter((m) => Math.abs(m.t - best.t) <= 30 * 60000).map((m) => " · 🐟 " + m.label).join("");
      tip.textContent = `${q.m}.${q.d}. ${q.h}:00 · ${numFmt(best.v, dec)} ${unit}${near}`;
    };
    svg.addEventListener("pointermove", show);
    svg.addEventListener("pointerdown", show);
    svg.addEventListener("pointerleave", () => { xh.classList.add("hidden"); xd.classList.add("hidden"); tip.textContent = ""; });
  }

  // ---- Térkép: a túra helye és a fogások ----
  function drawMap(t, cs) {
    const card = $("#tripMapCard"), hint = $("#tripMapHint");
    const pts = cs.filter((c) => c.lat != null && c.lon != null);
    const hasPlace = t.lat != null && t.lon != null;
    if (!pts.length && !hasPlace) { card.classList.add("hidden"); return; }
    if (!window.L || !navigator.onLine) { $("#tripMap").classList.add("hidden"); hint.textContent = "A térképhez internetkapcsolat kell."; return; }
    try {
      const m = L.map("tripMap", { zoomControl: true, scrollWheelZoom: false });
      L.tileLayer(A.CFG.MAP_TILES || "https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> közreműködők'
      }).addTo(m);
      const ll = [];
      if (hasPlace) {
        const p = [Number(t.lat), Number(t.lon)];
        L.circleMarker(p, { radius: 9, weight: 3, color: "#0f6e6a", fillColor: "#ffffff", fillOpacity: 1 }).addTo(m).bindPopup(`<b>${esc(t.title)}</b><br>a túra helye`);
        ll.push(p);
      }
      pts.forEach((c) => {
        const p = [Number(c.lat), Number(c.lon)];
        L.marker(p).addTo(m).bindPopup(`<b>${esc(c.species)}${c.weight_kg != null ? " – " + esc(kg(c.weight_kg)) : ""}</b><br>${esc(A.anglerOf(c))}<br>${esc(dtFmt(c.caught_at))}`);
        ll.push(p);
      });
      if (ll.length === 1) m.setView(ll[0], 14); else m.fitBounds(ll, { padding: [24, 24], maxZoom: 16 });
      T.map = m;
      setTimeout(() => { try { m.invalidateSize(); } catch (_) { /* bezárva */ } }, 60);
      hint.textContent = `${pts.length} fogás helye${hasPlace ? " · a kör a túra helye" : ""}`;
    } catch (x) { console.warn(x); card.classList.add("hidden"); }
  }

  // ---- Fogások ----
  function renderCatches(out, t, cs) {
    const s = status(t);
    const guests = guestsOf(t);
    const near = A.everyEntry().filter((c) => !inTrip(t, c) && ms(c.caught_at) >= ms(t.start_at) - 86400000 && ms(c.caught_at) <= ms(t.end_at) + 86400000)
      .sort((a, b) => (a.caught_at < b.caught_at ? -1 : 1));
    const excluded = T.links.filter((l) => l.trip_id === t.id && !l.included).length;
    out.innerHTML = `
      <div class="card">
        <div class="row-btns">
          ${s !== "planned" ? `<button type="button" class="btn small primary" data-trip-catch="own">＋ Saját fogás</button>` : ""}
          ${s !== "planned" ? `<button type="button" class="btn small" data-trip-catch="guest" ${guests.length ? "" : "disabled"}>＋ Vendég fogása</button>` : ""}
          <button type="button" class="btn small" data-trip-pick>${T.pickMode ? "Kész" : "Fogás hozzáadása kézzel"}</button>
        </div>
        <p class="hint">${s === "planned" ? "A túra még nem kezdődött el. " : ""}Automatikusan ide kerül minden fogás, amely ${esc(rangeText(t))} között, a(z) ${esc(t.water)} vízterületen született.${guests.length || s === "planned" ? "" : " Vendégfogáshoz előbb vedd fel a vendéget a résztvevők közé (Áttekintés)."}${excluded ? ` ${excluded} fogást kézzel kivettetek.` : ""}</p>
        <p class="hint">A vendégek fogása versenyen kívüli: csak itt, a túranaplóban látszik, a naplóban és az összesítőkben nem.</p>
      </div>
      ${T.pickMode ? `<div class="card"><strong>Hozzáadható fogások (a túra előtti és utáni napot is mutatom)</strong>
        ${near.length ? `<ul class="pick-list">${near.map((c) => `<li><span>${esc(c.species)}${c.weight_kg != null ? " – " + esc(kg(c.weight_kg)) : ""}<small>${esc(A.anglerOf(c))} · ${esc(c.water)} · ${esc(dtFmt(c.caught_at))}</small></span>
          <button type="button" class="btn small" data-link-in="${esc(c.client_id)}">Hozzáad</button></li>`).join("")}</ul>` : `<p class="hint">Nincs ilyen fogás.</p>`}</div>` : ""}
      ${cs.length > 1 ? `<div class="trip-sort"><div class="seg2" role="group" aria-label="Sorrend">
        <button type="button" data-trip-sort="time" class="${T.catchSort === "time" ? "active" : ""}" aria-pressed="${T.catchSort === "time"}">Időrend</button>
        <button type="button" data-trip-sort="rank" class="${T.catchSort === "rank" ? "active" : ""}" aria-pressed="${T.catchSort === "rank"}">Rangsor (súly)</button></div></div>` : ""}
      ${cs.length ? sortCatches(cs).map(({ c, rank }) => `<div class="card trip-catch">${rank ? `<div class="trip-rank">${rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : rank + "."} helyezés</div>` : ""}${A.cardHtml(c, { inner: true })}
        ${c._pending ? "" : `<div class="trip-catch-foot"><button type="button" class="link" data-link-out="${esc(c.client_id)}">Kivétel a túrából</button></div>`}</div>`).join("")
        : `<div class="card empty">Még nincs fogás ezen a túrán.</div>`}`;
    A.loadThumbs(out, cs);
  }

  // Rangsor: súly szerint csökkenő, azonos súlynál azonos helyezés; vendég és súly nélküli fogás helyezés nélkül a végén
  function sortCatches(cs) {
    if (T.catchSort !== "rank") return cs.map((c) => ({ c, rank: 0 }));
    const scored = cs.filter((c) => !c.guest_name && c.weight_kg != null).sort((a, b) => Number(b.weight_kg) - Number(a.weight_kg));
    let prev = null, rank = 0;
    const out = scored.map((c, i) => { const v = Number(c.weight_kg); if (v !== prev) rank = i + 1; prev = v; return { c, rank }; });
    return out.concat(cs.filter((c) => !scored.includes(c)).map((c) => ({ c, rank: 0 })));
  }

  async function setLink(cid, included) {
    if (!navigator.onLine) { toast("Ehhez internetkapcsolat kell."); return; }
    try {
      const { error } = await state.sb.from("trip_catch_links")
        .upsert({ trip_id: T.openId, client_id: cid, included, set_by: state.uid }, { onConflict: "trip_id,client_id" });
      if (error) throw error;
      toast(included ? "Fogás hozzáadva a túrához." : "Fogás kivéve a túrából.");
      await refresh();
    } catch (x) { toast(errText(x)); }
  }

  // ---- Album ----
  function renderAlbum(out, t, cs) {
    const ph = T.photos.filter((p) => p.trip_id === t.id).sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
    const catchPh = [];
    cs.filter((c) => !c._pending).forEach((c) => A.catchPhotoPaths(c).forEach((path) => catchPh.push({ c, path })));
    out.innerHTML = `
      <div class="card">
        <div class="photo-actions">
          <label class="btn small">📷 Fotó készítése<input type="file" accept="image/*" capture="environment" class="visually-hidden" data-album-pick></label>
          <label class="btn small">🖼 Galériából<input type="file" accept="image/*" multiple class="visually-hidden" data-album-pick></label>
        </div>
        <p class="hint">Bármilyen kép feltölthető (táj, tábor, csapat), mindegyikhez rövid memóval. A túra fogásainak fotói is itt látszanak 🐟 jellel.</p>
        ${T.queue.length ? `<div class="queue">
          ${T.queue.map((q, i) => `<div class="q-item"><img src="${esc(q.url)}" alt="">
            <textarea data-q-memo="${i}" rows="2" maxlength="300" placeholder="Rövid memó (nem kötelező)">${esc(q.memo || "")}</textarea>
            <button type="button" class="x-btn" data-q-del="${i}" aria-label="Kép elvetése">✕</button></div>`).join("")}
          <div class="row-btns"><button type="button" class="btn primary small" data-q-upload>Feltöltés (${T.queue.length})</button>
            <button type="button" class="btn small" data-q-clear>Mégse</button></div>
          <p class="msg" id="qMsg" role="status"></p></div>` : ""}
      </div>
      ${ph.length || catchPh.length ? `<div class="album-grid">
        ${ph.map((p, i) => `<figure class="a-tile" data-a="${i}">
          <button type="button" class="a-img" data-album-view="p${i}" aria-label="Kép megnyitása"><img alt="" loading="lazy" data-path="${esc(p.path)}"></button>
          <figcaption>${p.memo ? esc(p.memo) : `<span class="hint">nincs memó</span>`}<small>${esc(A.nameOf(p.user_id))}</small>
            ${own(p) ? `<span class="a-acts"><button type="button" class="link" data-memo-edit="${esc(p.id)}">✎ Memó</button><button type="button" class="link btn-danger-link" data-photo-del="${esc(p.id)}">Törlés</button></span>` : ""}
          </figcaption></figure>`).join("")}
        ${catchPh.map((x, i) => `<figure class="a-tile">
          <button type="button" class="a-img" data-album-view="c${i}" aria-label="Fogás fotójának megnyitása"><img alt="" loading="lazy" data-path="${esc(x.path)}"><span class="a-fish">🐟</span></button>
          <figcaption>${esc(x.c.species)}${x.c.weight_kg != null ? " – " + esc(kg(x.c.weight_kg)) : ""}<small>${esc(A.anglerOf(x.c))}</small></figcaption></figure>`).join("")}
      </div>` : `<div class="card empty">Még nincs kép ezen a túrán.</div>`}`;
    T.albumItems = ph.map((p) => ({ path: p.path, caption: `${p.memo ? p.memo + " – " : ""}${A.nameOf(p.user_id)}, ${dtFmt(p.created_at)}` }))
      .concat(catchPh.map((x) => ({ path: x.path, caption: A.captionOf(x.c) })));
    (async () => {
      const urls = await A.signedUrlsFor(T.albumItems.map((x) => x.path));
      out.querySelectorAll("img[data-path]").forEach((img) => { const u = urls[img.dataset.path]; if (u) img.src = u; });
    })();
  }

  async function viewAlbum(code) {
    const items = T.albumItems || [];
    const nOwn = T.photos.filter((p) => p.trip_id === T.openId).length;
    const i = code[0] === "p" ? Number(code.slice(1)) : nOwn + Number(code.slice(1));
    const urls = await A.signedUrlsFor(items.map((x) => x.path));
    const list = items.map((x) => ({ url: urls[x.path], caption: x.caption })).filter((x) => x.url);
    const idx = Math.max(0, list.findIndex((x) => x.url === urls[items[i] && items[i].path]));
    A.openViewer(list.map((x) => x.url), idx, list.map((x) => x.caption));
  }

  async function onAlbumPick(input) {
    const files = Array.from(input.files || []);
    input.value = "";
    if (!files.length) return;
    const room = 20 - T.queue.length;
    for (const f of files.slice(0, room)) {
      try {
        const { blob } = await A.prepareImage(f);
        T.queue.push({ blob, url: URL.createObjectURL(blob), memo: "" });
      } catch (x) { toast(errText(x)); }
    }
    if (files.length > room) toast("Egyszerre legfeljebb 20 kép tölthető fel.");
    render();
  }

  async function uploadQueue() {
    const msg = $("#qMsg");
    if (!navigator.onLine) { msg.className = "msg err"; msg.textContent = "A feltöltéshez internetkapcsolat kell."; return; }
    const btn = document.querySelector("[data-q-upload]");
    btn.disabled = true;
    let ok = 0;
    try {
      for (let i = 0; i < T.queue.length; i++) {
        const q = T.queue[i];
        if (q.done) continue;
        msg.className = "msg"; msg.textContent = `Feltöltés: ${i + 1} / ${T.queue.length}…`;
        const path = `${state.uid}/trip-${T.openId}/${A.uuid()}.${A.extOf(q.blob.type)}`;
        await A.uploadPhoto(q.blob, path);
        const { error } = await state.sb.from("trip_photos").insert({ trip_id: T.openId, path, memo: (q.memo || "").trim() || null });
        if (error) { state.sb.storage.from("photos").remove([path]).catch(() => {}); throw error; }
        q.done = true; ok++;
      }
      T.queue.forEach((q) => URL.revokeObjectURL(q.url)); T.queue = [];
      toast(`${ok} kép feltöltve.`);
      await refresh();
    } catch (x) {
      T.queue = T.queue.filter((q) => !q.done);
      msg.className = "msg err"; msg.textContent = `A feltöltés megszakadt (${ok} kép felment): ${errText(x)}`;
      btn.disabled = false;
      if (ok) refresh();
    }
  }

  async function editMemo(id) {
    const p = T.photos.find((x) => x.id === id);
    if (!p) return;
    const v = prompt("Memó a képhez:", p.memo || "");
    if (v == null) return;
    try {
      const { data, error } = await state.sb.from("trip_photos").update({ memo: v.trim().slice(0, 300) || null }).eq("id", id).select("id");
      if (error) throw error;
      if (!data || !data.length) throw new Error("Nincs jogosultságod a memó módosításához.");
      await refresh();
    } catch (x) { toast(errText(x)); }
  }
  async function delPhoto(id) {
    const p = T.photos.find((x) => x.id === id);
    if (!p || !confirm("Biztosan törlöd ezt a képet?")) return;
    try {
      const { data, error } = await state.sb.from("trip_photos").delete().eq("id", id).select("id");
      if (error) throw error;
      if (!data || !data.length) throw new Error("Nincs jogosultságod a kép törléséhez.");
      state.sb.storage.from("photos").remove([p.path]).catch(() => {});
      await refresh();
    } catch (x) { toast(errText(x)); }
  }

  // ---- Beszámolók ----
  function renderPosts(out, t) {
    const posts = T.posts.filter((p) => p.trip_id === t.id).sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
    out.innerHTML = `
      ${posts.length ? posts.map((p) => `<div class="card post">
        <div class="post-head"><b>${esc(A.nameOf(p.user_id))}</b><span class="hint">${esc(dtFmt(p.created_at))}${p.updated_at ? " · módosítva" : ""}</span></div>
        ${T.editPost === p.id
          ? `<textarea class="post-edit" rows="5" maxlength="5000">${esc(p.body)}</textarea>
             <div class="row-btns"><button type="button" class="btn small primary" data-post-save="${esc(p.id)}">Mentés</button><button type="button" class="btn small" data-post-cancel>Mégse</button></div>`
          : `<div class="pre">${esc(p.body)}</div>
             ${own(p) ? `<div class="catch-actions"><button type="button" class="link" data-post-edit="${esc(p.id)}">Szerkesztés</button><button type="button" class="link btn-danger-link" data-post-del="${esc(p.id)}">Törlés</button></div>` : ""}`}
      </div>`).join("") : `<div class="card empty">Még nincs beszámoló. Írd meg, mi történt a túrán!</div>`}
      <div class="card">
        <label class="field">Új beszámoló
          <textarea id="postNew" rows="4" maxlength="5000" placeholder="Mi történt ma? Időjárás, kapások, csalik, emlékezetes pillanatok…"></textarea>
        </label>
        <button type="button" class="btn primary small" data-post-send>Közzététel</button>
      </div>`;
  }

  async function sendPost() {
    const ta = $("#postNew");
    const body = ta.value.trim();
    if (!body) { toast("Írj valamit a beszámolóba."); return; }
    if (!navigator.onLine) { toast("A közzétételhez internetkapcsolat kell. A szöveg a mezőben marad."); return; }
    try {
      const { error } = await state.sb.from("trip_posts").insert({ trip_id: T.openId, body });
      if (error) throw error;
      ta.value = "";
      toast("Beszámoló közzétéve.");
      await refresh();
    } catch (x) { toast(errText(x)); }
  }
  async function savePost(id) {
    const ta = document.querySelector(".post-edit");
    const body = ta ? ta.value.trim() : "";
    if (!body) { toast("A beszámoló nem lehet üres."); return; }
    try {
      const { data, error } = await state.sb.from("trip_posts").update({ body, updated_at: new Date().toISOString() }).eq("id", id).select("id");
      if (error) throw error;
      if (!data || !data.length) throw new Error("Nincs jogosultságod a módosításhoz.");
      T.editPost = null;
      await refresh();
    } catch (x) { toast(errText(x)); }
  }
  async function delPost(id) {
    if (!confirm("Biztosan törlöd ezt a beszámolót?")) return;
    try {
      const { data, error } = await state.sb.from("trip_posts").delete().eq("id", id).select("id");
      if (error) throw error;
      if (!data || !data.length) throw new Error("Nincs jogosultságod a törléshez.");
      await refresh();
    } catch (x) { toast(errText(x)); }
  }

  // ------------------------------------------------------------------
  // Eseménykezelés (a #tabTrips-en belül + a fogáskártyák túra-linkje)
  // ------------------------------------------------------------------
  function onClick(e) {
    const g = (sel) => e.target.closest(sel);
    let el;
    if ((el = g("[data-trip-open]"))) { A.showTab("tabTrips"); open(el.dataset.tripOpen); return; }
    if (!g("#tabTrips")) return;
    if (g("[data-trip-new]")) return openForm(null);
    if (g("[data-trip-cancel]")) { T.view = T.editId ? "detail" : "list"; render(); return; }
    if (g("[data-trip-back]")) { T.view = "list"; T.openId = null; render(); return; }
    if ((el = g("[data-trip-edit]"))) return openForm(el.dataset.tripEdit);
    if ((el = g("[data-trip-del]"))) return deleteTrip(el.dataset.tripDel);
    if ((el = g("[data-trip-sec]"))) { T.sec = el.dataset.tripSec; T.pickMode = false; render(); return; }
    if ((el = g("[data-trip-chip]"))) return formChip(el.dataset.tripChip);
    if ((el = g("[data-trip-loc]"))) return formLoc(el.dataset.tripLoc);
    if ((el = g("[data-rsvp]"))) return setRsvp(el.dataset.rsvp);
    if (g("[data-add-member]")) { const v = $("#addMember").value; if (v) addPerson({ user_id: v }); return; }
    if (g("[data-add-guest]")) {
      const v = $("#addGuest").value.trim().slice(0, 40);
      if (!v) { toast("Írd be a vendég nevét."); return; }
      addPerson({ guest_name: v }); return;
    }
    if ((el = g("[data-person-del]"))) return delPerson(el.dataset.personDel);
    if ((el = g("[data-trip-catch]"))) {
      const t = tripById(T.openId);
      A.startCatchForTrip(t, el.dataset.tripCatch === "guest" ? guestsOf(t) : null);
      return;
    }
    if (g("[data-trip-pick]")) { T.pickMode = !T.pickMode; render(); return; }
    if ((el = g("[data-trip-sort]"))) { T.catchSort = el.dataset.tripSort; render(); return; }
    if ((el = g("[data-link-in]"))) return setLink(el.dataset.linkIn, true);
    if ((el = g("[data-link-out]"))) {
      if (confirm("Kiveszed ezt a fogást a túrából? (A fogás a naplóban megmarad.)")) setLink(el.dataset.linkOut, false);
      return;
    }
    if ((el = g("[data-album-view]"))) return viewAlbum(el.dataset.albumView);
    if ((el = g("[data-q-del]"))) { const q = T.queue.splice(Number(el.dataset.qDel), 1)[0]; if (q) URL.revokeObjectURL(q.url); render(); return; }
    if (g("[data-q-clear]")) { T.queue.forEach((q) => URL.revokeObjectURL(q.url)); T.queue = []; render(); return; }
    if (g("[data-q-upload]")) return uploadQueue();
    if ((el = g("[data-memo-edit]"))) return editMemo(el.dataset.memoEdit);
    if ((el = g("[data-photo-del]"))) return delPhoto(el.dataset.photoDel);
    if (g("[data-post-send]")) return sendPost();
    if ((el = g("[data-post-edit]"))) { T.editPost = el.dataset.postEdit; render(); return; }
    if (g("[data-post-cancel]")) { T.editPost = null; render(); return; }
    if ((el = g("[data-post-save]"))) return savePost(el.dataset.postSave);
    if ((el = g("[data-post-del]"))) return delPost(el.dataset.postDel);
  }

  function bind() {
    document.addEventListener("click", onClick);
    const tab = $("#tabTrips");
    tab.addEventListener("input", (e) => {
      if (e.target.dataset.fmt) onFormInput(e);
      if (e.target.dataset.qMemo != null) { const q = T.queue[Number(e.target.dataset.qMemo)]; if (q) q.memo = e.target.value; }
    });
    tab.addEventListener("change", (e) => {
      if (e.target.matches("[data-album-pick]")) onAlbumPick(e.target);
      if (e.target.id === "tripPrevPlaces") formPlace(e.target);
    });
    tab.addEventListener("submit", (e) => { if (e.target.id === "tripForm") saveForm(e); });
  }

  // Értesítésből: #tura-<azonosító>
  function openFromHash() {
    const m = location.hash.match(/^#tura-([0-9a-f-]{8,})$/i);
    if (!m) return false;
    history.replaceState(null, "", location.pathname + location.search);
    A.showTab("tabTrips");
    open(m[1]);
    if (!tripById(m[1])) refresh().then(() => { if (tripById(m[1])) open(m[1]); });
    return true;
  }

  bind();
  return {
    refresh, loadCache, render, open, openFromHash, tripsOfCatch, tripById, all: () => T.trips,
    // teszteléshez
    _: { waterMatch, status, catchesOf, peopleOf, keyToMs, T }
  };
};
