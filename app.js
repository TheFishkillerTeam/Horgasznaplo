/* =====================================================================
   Horgásznapló – fő alkalmazáslogika
   Adatbázis: Supabase · Időjárás: Open-Meteo (CC BY 4.0)
   ===================================================================== */
(() => {
  "use strict";

  const CFG = window.APP_CONFIG || {};
  const TZ = CFG.TIMEZONE || "Europe/Budapest";
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  // iPhone / iPad felismerése (az iPadOS asztali Safarinak adja ki magát)
  const IS_IOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const IS_STANDALONE = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;

  const DEFAULT_SPECIES = [
    "Ponty", "Amur", "Busa", "Kárász", "Ezüstkárász", "Compó", "Dévérkeszeg",
    "Karikakeszeg", "Bodorka", "Vörösszárnyú keszeg", "Jászkeszeg", "Márna",
    "Paduc", "Balin", "Csuka", "Süllő", "Kősüllő", "Sügér", "Harcsa", "Angolna",
    "Sebes pisztráng", "Szivárványos pisztráng", "Naphal", "Törpeharcsa", "Kecsege"
  ];

  // WMO időjárás-kódok magyarul
  const WMO = {
    0: "derült", 1: "többnyire derült", 2: "részben felhős", 3: "borult",
    45: "köd", 48: "zúzmarás köd",
    51: "gyenge szitálás", 53: "szitálás", 55: "erős szitálás",
    56: "ónos szitálás", 57: "erős ónos szitálás",
    61: "gyenge eső", 63: "eső", 65: "erős eső",
    66: "ónos eső", 67: "erős ónos eső",
    71: "gyenge havazás", 73: "havazás", 75: "erős havazás", 77: "hószemcse",
    80: "gyenge zápor", 81: "zápor", 82: "heves zápor",
    85: "hózápor", 86: "erős hózápor",
    95: "zivatar", 96: "zivatar jégesővel", 99: "erős zivatar jégesővel"
  };

  // ------------------------------------------------------------------
  // Segédfüggvények
  // ------------------------------------------------------------------
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));

  const numFmt = (n, d = 2) =>
    n == null || n === "" || isNaN(n) ? "" :
      Number(n).toLocaleString("hu-HU", { maximumFractionDigits: d });

  const dtFmt = (iso) => new Date(iso).toLocaleString("hu-HU", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit"
  });

  // A megadott időpont dátum/óra részei a beállított időzónában
  function tzParts(date) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23"
    }).formatToParts(date);
    const o = {};
    parts.forEach((p) => { o[p.type] = p.value; });
    return { y: o.year, m: o.month, d: o.day, h: o.hour, min: o.minute };
  }
  const yearOf = (iso) => tzParts(new Date(iso)).y;
  const monthOf = (iso) => { const p = tzParts(new Date(iso)); return `${p.y}.${p.m}.`; };

  // datetime-local mező értéke (a telefon helyi ideje szerint)
  function localInputValue(d = new Date()) {
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  // ---- A fogás időpontja: két kézzel írható mező (dátum + idő) + rejtett ISO-mező ----
  const pad2 = (n) => String(n).padStart(2, "0");
  function setCatchTime(d) {
    $("#catchDate").value = `${d.getFullYear()}.${pad2(d.getMonth() + 1)}.${pad2(d.getDate())}`;
    $("#catchTime").value = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
    syncCatchTime(true);
  }
  // A beírt szövegből Date (a telefon helyi ideje szerint), vagy null + hibaüzenet
  function parseCatchTime() {
    const ds = $("#catchDate").value.trim(), ts = $("#catchTime").value.trim();
    const dm = ds.match(/^(\d{4})[.\-\/ ]?(\d{1,2})[.\-\/ ]?(\d{1,2})\.?$/);
    const tm = ts.match(/^(\d{1,2})[:.]?(\d{2})$/);
    if (!dm) return { error: "A dátumot így add meg: ÉÉÉÉ.HH.NN (pl. 2026.10.12)." , field: "date" };
    if (!tm) return { error: "Az időt így add meg: ÓÓ:PP (pl. 06:40).", field: "time" };
    const y = +dm[1], mo = +dm[2], da = +dm[3], h = +tm[1], mi = +tm[2];
    const d = new Date(y, mo - 1, da, h, mi);
    if (d.getFullYear() !== y || d.getMonth() !== mo - 1 || d.getDate() !== da || h > 23 || mi > 59)
      return { error: "Nem létező dátum vagy idő.", field: h > 23 || mi > 59 ? "time" : "date" };
    return { date: d };
  }
  function syncCatchTime(quiet) {
    const r = parseCatchTime();
    const hidden = $("#catchForm").caught_at;
    $("#catchDate").classList.toggle("bad", !quiet && !!r.error && r.field === "date");
    $("#catchTime").classList.toggle("bad", !quiet && !!r.error && r.field === "time");
    const msg = $("#dtMsg");
    if (r.error) {
      hidden.value = "";
      msg.className = "msg err"; msg.textContent = quiet ? "" : r.error;
      return;
    }
    hidden.value = localInputValue(r.date);
    msg.className = "msg"; msg.textContent = "";
    checkLateTime();
  }
  // Gépelés közbeni formázás: pontok és kettőspont automatikusan
  function formatDateInput(e) {
    const el = e.target;
    let v = el.value.replace(/[^\d]/g, "").slice(0, 8);
    if (v.length > 6) v = `${v.slice(0, 4)}.${v.slice(4, 6)}.${v.slice(6)}`;
    else if (v.length > 4) v = `${v.slice(0, 4)}.${v.slice(4)}`;
    el.value = v;
    if (v.length === 10) { syncCatchTime(false); $("#catchTime").focus(); }
  }
  function formatTimeInput(e) {
    const el = e.target;
    let v = el.value.replace(/[^\d]/g, "").slice(0, 4);
    if (v.length > 2) v = `${v.slice(0, 2)}:${v.slice(2)}`;
    el.value = v;
    if (v.length === 5) syncCatchTime(false);
  }
  function shiftCatchTime(code) {
    if (code === "now") { setCatchTime(new Date()); return; }
    const r = parseCatchTime();
    const base = r.date || new Date();
    setCatchTime(new Date(base.getTime() + Number(code) * 60000));
  }

  function uuid() {
    if (crypto.randomUUID) return crypto.randomUUID();
    return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) =>
      (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16));
  }

  let toastTimer;
  function toast(msg, ms = 3000) {
    const t = $("#toast");
    t.textContent = msg;
    t.classList.remove("hidden");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.add("hidden"), ms);
  }

  function errText(e) {
    const m = (e && (e.message || e.error_description || e.msg)) || String(e);
    if (/Invalid login credentials/i.test(m)) return "Hibás e-mail-cím vagy jelszó.";
    if (/Email not confirmed/i.test(m)) return "Az e-mail-cím még nincs megerősítve. Nézd meg a postafiókodat.";
    if (/already registered|already exists/i.test(m)) return "Ezzel az e-mail-címmel már van regisztráció.";
    if (/Password should be/i.test(m)) return "A jelszó túl rövid vagy túl egyszerű.";
    if (/Failed to fetch|NetworkError|network/i.test(m)) return "Nincs internetkapcsolat.";
    if (/Signups not allowed/i.test(m)) return "A regisztráció jelenleg le van zárva. Kérd az adminisztrátort.";
    if (/email rate limit|over_email_send_rate_limit/i.test(m)) return "Túl sok e-mail lett kiküldve. Az ingyenes levelező óránként csak néhány levelet küld; próbáld újra később.";
    if (/same.*password|New password should be different/i.test(m)) return "Az új jelszó nem lehet azonos a régivel.";
    if (/rate limit/i.test(m)) return "Túl sok próbálkozás. Várj egy kicsit, és próbáld újra.";
    return m;
  }

  // ------------------------------------------------------------------
  // Helyi tároló (IndexedDB): offline várólista + gyorsítótár
  // ------------------------------------------------------------------
  const idb = (() => {
    let dbp;
    function open() {
      if (dbp) return dbp;
      dbp = new Promise((resolve, reject) => {
        const req = indexedDB.open("horgasznaplo", 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains("outbox")) db.createObjectStore("outbox", { keyPath: "client_id" });
          if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv");
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      return dbp;
    }
    async function tx(store, mode, fn) {
      const db = await open();
      return new Promise((resolve, reject) => {
        const t = db.transaction(store, mode);
        const s = t.objectStore(store);
        const r = fn(s);
        t.oncomplete = () => resolve(r && "result" in r ? r.result : undefined);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      });
    }
    return {
      put: (store, val, key) => tx(store, "readwrite", (s) => (key !== undefined ? s.put(val, key) : s.put(val))),
      get: (store, key) => tx(store, "readonly", (s) => s.get(key)),
      del: (store, key) => tx(store, "readwrite", (s) => s.delete(key)),
      all: (store) => tx(store, "readonly", (s) => s.getAll())
    };
  })();

  // ------------------------------------------------------------------
  // Állapot
  // ------------------------------------------------------------------
  const state = {
    sb: null,
    uid: null,
    me: null,            // saját profil
    profiles: {},        // id -> profil
    catches: [],         // szerveren lévő fogások
    outbox: [],          // szinkronizálásra váró saját fogások
    syncing: false,
    photo: null,         // { blob, url } az új fogás űrlapon
    gps: null,           // { lat, lon, acc, source: "gps" | "map" | "list" | "saved" }
    signedUrls: {},      // photo_path -> { url, exp }
    editing: null,       // szerkesztett fogás: { client_id, pending, original }
    recovery: false      // jelszó-visszaállítási link érkezett
  };

  // ------------------------------------------------------------------
  // Nézetek
  // ------------------------------------------------------------------
  function show(viewId) {
    $$(".view").forEach((v) => v.classList.toggle("hidden", v.id !== viewId));
    const main = viewId === "viewMain";
    $("#bottomNav").classList.toggle("hidden", !main);
    $("#btnMenu").classList.toggle("hidden", !(main || viewId === "viewMembers" || viewId === "viewPending"));
    $("#menuPanel").classList.add("hidden");
  }

  function showTab(tabId) {
    $$(".tab").forEach((t) => t.classList.toggle("hidden", t.id !== tabId));
    $$("#bottomNav button").forEach((b) => b.classList.toggle("active", b.dataset.tab === tabId));
    if (tabId === "tabLog") renderLog();
    if (tabId === "tabStats") renderStats();
    if (tabId === "tabNew" && !state.gps && !state.editing && isRecentTime()) requestGps(true);
    window.scrollTo(0, 0);
  }

  function updateNet() {
    const b = $("#netBadge");
    const on = navigator.onLine;
    b.textContent = on ? "Online" : "Offline";
    b.className = "badge " + (on ? "online" : "offline");
    const n = state.outbox.length;
    const s = $("#btnSync");
    s.classList.toggle("hidden", n === 0);
    s.textContent = state.syncing ? "⟳ Küldés…" : `⟳ ${n} vár`;
  }

  // ------------------------------------------------------------------
  // Indulás
  // ------------------------------------------------------------------
  async function start() {
    $("#clubName").textContent = CFG.CLUB_NAME || "Horgásznapló";
    document.title = (CFG.CLUB_NAME ? CFG.CLUB_NAME + " – " : "") + "Horgásznapló";

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    }

    bindUi();
    updateNet();

    // iPhone-on, ha nincs telepítve: figyelmeztetés a kezdőképernyőre tételről
    let iosHidden = false;
    try { iosHidden = localStorage.getItem("iosInstallHidden") === "1"; } catch (_) { /* nincs tároló */ }
    if (IS_IOS && !IS_STANDALONE && !iosHidden) $("#iosInstall").classList.remove("hidden");
    $("#btnIosHide").addEventListener("click", () => {
      $("#iosInstall").classList.add("hidden");
      try { localStorage.setItem("iosInstallHidden", "1"); } catch (_) { /* nincs tároló */ }
    });

    const configured = CFG.SUPABASE_URL && /^https:\/\//.test(CFG.SUPABASE_URL) &&
      CFG.SUPABASE_KEY && !/^IDE_JON/.test(CFG.SUPABASE_KEY);
    if (!configured || !window.supabase) { show("viewConfig"); return; }

    // Jelszó-visszaállító linkről érkezett? (az URL-ben "type=recovery" szerepel)
    state.recovery = /type=recovery/.test(location.hash);

    state.sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: "implicit" }
    });

    state.sb.auth.onAuthStateChange((event, sess) => {
      if (event === "PASSWORD_RECOVERY") {
        state.recovery = true;
        if (sess) state.uid = sess.user.id;
        show("viewNewPassword");
        return;
      }
      if (state.recovery) return;
      if (event === "SIGNED_OUT") {
        state.uid = null; state.me = null;
        show("viewAuth");
      } else if (sess && !state.uid) {
        state.uid = sess.user.id;
        setTimeout(() => enterApp(), 0);
      }
    });

    state.outbox = (await idb.all("outbox").catch(() => [])) || [];
    updateNet();

    let session = null;
    try {
      const { data } = await state.sb.auth.getSession();
      session = data.session;
    } catch (_) { /* offline */ }

    if (state.recovery) {
      if (session) state.uid = session.user.id;
      show("viewNewPassword");
    } else if (session) {
      state.uid = session.user.id;
      await enterApp();
    } else {
      // Offline indulás: ha korábban már be volt jelentkezve, a tárolt adatokkal folytatjuk
      const cachedMe = await idb.get("kv", "me").catch(() => null);
      if (!navigator.onLine && cachedMe && cachedMe.approved) {
        state.uid = cachedMe.id;
        state.me = cachedMe;
        await loadCache();
        enterMain();
        toast("Offline mód – a fogások a kapcsolat helyreállása után kerülnek fel.");
      } else {
        show("viewAuth");
      }
    }
  }

  async function loadCache() {
    state.catches = (await idb.get("kv", "catches").catch(() => null)) || [];
    state.profiles = (await idb.get("kv", "profiles").catch(() => null)) || {};
  }

  let entering = null;
  function enterApp() {
    if (!entering) entering = doEnterApp().finally(() => { entering = null; });
    return entering;
  }

  async function doEnterApp() {
    if (state.recovery) return;
    await loadCache();
    try {
      const { data, error } = await state.sb.from("profiles").select("*").eq("id", state.uid).maybeSingle();
      if (error) throw error;
      if (data) { state.me = data; await idb.put("kv", data, "me"); }
    } catch (e) {
      state.me = (await idb.get("kv", "me").catch(() => null)) || state.me;
    }

    if (!state.me) {
      // A profil a regisztrációkor jön létre; ha még nincs, várakozó állapot
      show("viewPending");
      return;
    }
    if (!state.me.approved) { show("viewPending"); return; }

    enterMain();
    refreshData();
    syncOutbox();
  }

  function enterMain() {
    $("#menuUser").textContent = `${state.me.display_name || ""}${state.me.is_admin ? " (admin)" : ""}`;
    $("#menuMembers").classList.toggle("hidden", !state.me.is_admin);
    show("viewMain");
    resetForm();
    fillDatalists();
    showTab("tabNew");
  }

  async function refreshData() {
    if (!navigator.onLine || !state.sb) return;
    try {
      const pr = await state.sb.from("profiles").select("id, display_name, approved");
      if (pr.error) throw pr.error;
      // A szerver lekérdezésenként legfeljebb 1000 sort ad, ezért lapozva töltjük le
      const PAGE = 1000;
      let rows = [];
      for (let from = 0; ; from += PAGE) {
        const cr = await state.sb.from("catches").select("*")
          .order("caught_at", { ascending: false }).order("id")
          .range(from, from + PAGE - 1);
        if (cr.error) throw cr.error;
        rows = rows.concat(cr.data);
        if (cr.data.length < PAGE) break;
      }
      state.profiles = {};
      pr.data.forEach((p) => { state.profiles[p.id] = p; });
      state.catches = rows;
      await idb.put("kv", state.profiles, "profiles");
      await idb.put("kv", state.catches, "catches");
      fillDatalists();
      if (!$("#tabLog").classList.contains("hidden")) renderLog();
      if (!$("#tabStats").classList.contains("hidden")) renderStats();
    } catch (e) {
      console.warn("Frissítés sikertelen:", e);
    }
  }

  // ------------------------------------------------------------------
  // Bejelentkezés / regisztráció
  // ------------------------------------------------------------------
  let authMode = "login";
  function setAuthMode(mode) {
    authMode = mode;
    $$(".seg-btn").forEach((b) => b.classList.toggle("active", b.dataset.auth === mode));
    $$(".reg-only").forEach((el) => el.classList.toggle("hidden", mode !== "register"));
    $("#authSubmit").textContent = mode === "login" ? "Belépés" : "Regisztráció";
    $("#btnForgot").classList.toggle("hidden", mode !== "login");
    $("#authForm").password.autocomplete = mode === "login" ? "current-password" : "new-password";
    $("#authMsg").textContent = "";
  }

  async function onAuthSubmit(ev) {
    ev.preventDefault();
    const f = ev.target;
    const msg = $("#authMsg");
    msg.className = "msg";
    const email = f.email.value.trim();
    const password = f.password.value;
    const btn = $("#authSubmit");
    btn.disabled = true;
    msg.textContent = "Folyamatban…";
    try {
      if (authMode === "login") {
        const { data, error } = await state.sb.auth.signInWithPassword({ email, password });
        if (error) throw error;
        state.uid = data.user.id;
        msg.textContent = "";
        await enterApp();
      } else {
        const name = f.display_name.value.trim();
        if (!name) throw new Error("Add meg a nevet, ahogy a listákban megjelenjen.");
        const { data, error } = await state.sb.auth.signUp({
          email, password,
          options: { data: { display_name: name }, emailRedirectTo: location.href.split("#")[0] }
        });
        if (error) throw error;
        if (data.session) {
          state.uid = data.user.id;
          msg.textContent = "";
          await enterApp();
        } else {
          setAuthMode("login");
          msg.className = "msg ok";
          msg.textContent = "Sikeres regisztráció. Erősítsd meg az e-mail-címedet a kapott levélben, majd lépj be.";
        }
      }
    } catch (e) {
      msg.className = "msg err";
      msg.textContent = errText(e);
    } finally {
      btn.disabled = false;
    }
  }

  // Elfelejtett jelszó: visszaállító link e-mailben
  async function forgotPassword() {
    const msg = $("#authMsg");
    const email = $("#authForm").email.value.trim();
    msg.className = "msg";
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      msg.className = "msg err";
      msg.textContent = "Írd be fent az e-mail-címedet, majd kattints újra az „Elfelejtettem a jelszavam” gombra.";
      $("#authForm").email.focus();
      return;
    }
    if (!navigator.onLine) { msg.className = "msg err"; msg.textContent = "Nincs internetkapcsolat."; return; }
    const btn = $("#btnForgot");
    btn.disabled = true;
    msg.textContent = "Küldés…";
    try {
      const redirectTo = new URL("./", location.href).href;
      const { error } = await state.sb.auth.resetPasswordForEmail(email, { redirectTo });
      if (error) throw error;
      msg.className = "msg ok";
      msg.textContent = "Ha ezzel a címmel van regisztráció, hamarosan érkezik egy levél a jelszó-visszaállító linkkel. Nézd meg a levélszemét mappát is.";
    } catch (e) {
      msg.className = "msg err";
      msg.textContent = errText(e);
    } finally {
      btn.disabled = false;
    }
  }

  async function onNewPassword(ev) {
    ev.preventDefault();
    const msg = $("#newPassMsg");
    const p1 = $("#newPass1").value, p2 = $("#newPass2").value;
    msg.className = "msg err";
    if (p1.length < 8) { msg.textContent = "A jelszó legalább 8 karakter legyen."; return; }
    if (p1 !== p2) { msg.textContent = "A két jelszó nem egyezik."; return; }
    const btn = $("#btnNewPass");
    btn.disabled = true;
    msg.className = "msg"; msg.textContent = "Mentés…";
    try {
      const { error } = await state.sb.auth.updateUser({ password: p1 });
      if (error) throw error;
      state.recovery = false;
      history.replaceState(null, "", location.pathname + location.search);
      $("#newPass1").value = ""; $("#newPass2").value = "";
      toast("Az új jelszó mentve.");
      const { data } = await state.sb.auth.getSession();
      if (data.session) { state.uid = data.session.user.id; await enterApp(); }
      else show("viewAuth");
    } catch (e) {
      msg.className = "msg err";
      msg.textContent = /session/i.test(String(e && e.message)) ?
        "A visszaállító link lejárt vagy már felhasználták. Kérj új linket a belépő oldalon." : errText(e);
    } finally {
      btn.disabled = false;
    }
  }

  async function logout() {
    if (state.outbox.length && !confirm(`${state.outbox.length} fogás még nincs feltöltve. Kijelentkezés után is megmaradnak ezen a telefonon, és a következő belépéskor feltöltődnek. Kijelentkezel?`)) return;
    $("#menuPanel").classList.add("hidden");
    try { await state.sb.auth.signOut(); } catch (_) { /* offline */ }
    await idb.del("kv", "me").catch(() => {});
    state.uid = null; state.me = null;
    show("viewAuth");
  }

  // ------------------------------------------------------------------
  // Új fogás űrlap
  // ------------------------------------------------------------------
  function fillDatalists() {
    const uniq = (arr) => Array.from(new Set(arr.filter(Boolean).map((s) => s.trim()))).sort((a, b) => a.localeCompare(b, "hu"));
    const all = state.catches.concat(state.outbox);
    const species = uniq(DEFAULT_SPECIES.concat(all.map((c) => c.species)));
    $("#speciesList").innerHTML = species.map((s) => `<option value="${esc(s)}">`).join("");
    $("#waterList").innerHTML = uniq(all.map((c) => c.water)).map((s) => `<option value="${esc(s)}">`).join("");
    $("#baitList").innerHTML = uniq(all.map((c) => c.bait)).map((s) => `<option value="${esc(s)}">`).join("");
    fillPlaces();
  }

  function resetForm(forEdit) {
    const f = $("#catchForm");
    const wasEditing = !!state.editing;
    const keepWater = wasEditing ? "" : f.water.value;
    f.reset();
    f.water.value = keepWater; // ugyanazon a vízen általában több hal is jön
    setCatchTime(new Date());
    clearPhoto();
    state.photoRemoved = false;
    state.editing = null;
    $("#formTitle").textContent = "Új fogás";
    $("#btnCancelEdit").classList.add("hidden");
    $("#btnSave").textContent = "Mentés";
    $("#editInfo").classList.add("hidden");
    f.classList.remove("editing");
    $("#saveMsg").textContent = "";
    $("#lateWarn").classList.add("hidden");
    // Friss fogásnál a GPS-pozíció megmarad (ugyanaz a hely), egyébként törlődik
    if (forEdit || wasEditing || (state.gps && state.gps.source !== "gps")) setLocation(null);
    else renderLocation();
  }

  function clearPhoto() {
    if (state.photo && state.photo.url) URL.revokeObjectURL(state.photo.url);
    state.photo = null;
    $("#photoPreview").classList.add("hidden");
    $("#photoPreview").removeAttribute("src");
    $("#photoEmpty").classList.remove("hidden");
    $("#btnPhotoRemove").classList.add("hidden");
    $("#photoCamera").value = "";
    $("#photoGallery").value = "";
    setPhotoMsg("");
  }

  // Fotó kicsinyítése (max. 1600 px, JPEG) – kíméli az adatforgalmat és a tárhelyet
  function compressImage(file, maxSide = 1600, quality = 0.8) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
        const w = Math.round(img.naturalWidth * scale);
        const h = Math.round(img.naturalHeight * scale);
        const canvas = document.createElement("canvas");
        canvas.width = w; canvas.height = h;
        canvas.getContext("2d").drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(url);
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("A fotó feldolgozása nem sikerült."))), "image/jpeg", quality);
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("A fotó nem olvasható.")); };
      img.src = url;
    });
  }

  // Második út: createImageBitmap (néhány böngészőben megbízhatóbb, mint az <img>)
  async function compressViaBitmap(file, maxSide = 1600, quality = 0.8) {
    if (!window.createImageBitmap) throw new Error("nincs createImageBitmap");
    const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext("2d").drawImage(bmp, 0, 0, canvas.width, canvas.height);
    if (bmp.close) bmp.close();
    return new Promise((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob"))), "image/jpeg", quality));
  }

  function setPhotoMsg(text, isErr) {
    const m = $("#photoMsg");
    m.textContent = text || "";
    m.className = "msg" + (text ? (isErr ? " err" : " ok") : "");
  }

  async function onPhotoPicked(ev) {
    const input = ev.target;
    const file = input.files && input.files[0];
    if (!file) return;
    setPhotoMsg("Fotó feldolgozása…");
    let blob = null;
    try { blob = await compressImage(file); }
    catch (_) {
      try { blob = await compressViaBitmap(file); } catch (_) { blob = null; }
    }
    // Ha a telefon nem tudja kicsinyíteni (pl. ritka formátum), az eredeti fájlt mentjük, max. 10 MB-ig
    let note = "";
    if (!blob) {
      const heic = /hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name || "");
      if (heic && file.size > 0 && file.size <= 10 * 1024 * 1024) {
        blob = new Blob([file], { type: file.type || "image/heic" });
        note = "A fotót eredeti méretben mentem (a kicsinyítés ezen a készüléken nem sikerült).";
      } else {
        setPhotoMsg(`A fotó nem dolgozható fel (${file.type || "ismeretlen formátum"}, ${Math.round(file.size / 1024)} kB). Próbálj másik fotót választani.`, true);
        input.value = "";
        return;
      }
    }
    clearPhoto();
    state.photoRemoved = false;
    state.photo = { blob, url: URL.createObjectURL(blob) };
    const img = $("#photoPreview");
    img.onerror = () => setPhotoMsg("Az előnézet nem jeleníthető meg, de a fotó a fogással együtt mentésre kerül.", false);
    img.src = state.photo.url;
    img.classList.remove("hidden");
    $("#photoEmpty").classList.add("hidden");
    $("#btnPhotoRemove").classList.remove("hidden");
    setPhotoMsg(note || `Fotó csatolva (${Math.round(blob.size / 1024)} kB).`, false);
  }

  // ------------------------------------------------------------------
  // A fogás helye: GPS / térkép / korábbi helyek
  // ------------------------------------------------------------------
  const RECENT_MINUTES = 60; // ennél régebbi időpontnál utólagos rögzítésnek számít

  function isRecentTime() {
    const v = $("#catchForm").caught_at.value;
    if (!v) return true;
    const t = new Date(v).getTime();
    return isNaN(t) || Math.abs(Date.now() - t) <= RECENT_MINUTES * 60000;
  }

  function setLocation(loc) {
    state.gps = loc;
    renderLocation();
  }

  function renderLocation() {
    const st = $("#gpsStatus");
    const g = state.gps;
    $("#btnLocClear").classList.toggle("hidden", !g);
    if (!g) {
      st.textContent = isRecentTime()
        ? "Még nincs megadva."
        : "Még nincs megadva. Jelöld ki a térképen, vagy válassz a korábbi helyek közül.";
      return;
    }
    const src = { gps: "jelenlegi pozíció (GPS)", map: "térképen kijelölve", list: "korábbi helyről", saved: "mentett hely" }[g.source] || "";
    st.textContent = `${g.lat.toFixed(5)}, ${g.lon.toFixed(5)}${g.acc ? ` (±${Math.round(g.acc)} m)` : ""} – ${src}`;
  }

  // Ha az időpont régebbi: figyelmeztetés, és az automatikusan kapott GPS-pozíciót elvetjük
  function checkLateTime() {
    const late = !isRecentTime();
    const w = $("#lateWarn");
    w.classList.toggle("hidden", !late);
    if (late) {
      w.textContent = "Utólagos rögzítés: a jelenlegi tartózkodási helyed valószínűleg nem a fogás helye. Add meg a helyet a térképen vagy a korábbi helyek közül.";
      if (state.gps && state.gps.source === "gps" && state.gps.auto) {
        setLocation(null);
        toast("Az automatikus pozíciót töröltem, mert a fogás időpontja korábbi.");
      }
    }
    renderLocation();
  }

  function requestGps(auto) {
    const st = $("#gpsStatus");
    if (!("geolocation" in navigator)) { st.textContent = "Ez a készülék nem támogatja a helymeghatározást."; return; }
    if (auto && !isRecentTime()) return;
    st.textContent = "Pozíció keresése…";
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (auto && (!isRecentTime() || (state.gps && state.gps.source !== "gps"))) return; // közben mást választott
        setLocation({ lat: pos.coords.latitude, lon: pos.coords.longitude, acc: pos.coords.accuracy, source: "gps", auto: !!auto });
        if (!auto && !isRecentTime()) toast("Figyelem: a jelenlegi helyedet rögzítettem, de a fogás időpontja korábbi.");
      },
      (err) => {
        if (state.gps) { renderLocation(); return; }
        st.textContent = err.code === 1
          ? "A helymeghatározás nincs engedélyezve. Engedélyezd a böngésző beállításaiban, vagy jelöld ki a helyet a térképen."
          : "Nem sikerült pozíciót kapni. Próbáld újra a szabad ég alatt, vagy jelöld ki a helyet a térképen.";
      },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 60000 }
    );
  }

  // Korábbi fogáshelyek (a társaság összes fogásából, gyakoriság szerint)
  function fillPlaces() {
    const map = new Map();
    state.catches.concat(state.outbox).forEach((c) => {
      if (c.lat == null || c.lon == null) return;
      const key = `${(c.water || "").trim()}|${(c.spot || "").trim()}|${Number(c.lat).toFixed(3)}|${Number(c.lon).toFixed(3)}`;
      const e = map.get(key) || { water: c.water || "", spot: c.spot || "", lat: Number(c.lat), lon: Number(c.lon), n: 0, mine: 0 };
      e.n++;
      if (c.user_id === state.uid) e.mine++;
      map.set(key, e);
    });
    state.places = Array.from(map.values()).sort((a, b) => b.mine - a.mine || b.n - a.n || a.water.localeCompare(b.water, "hu"));
    const sel = $("#prevPlaces");
    sel.innerHTML = `<option value="">${state.places.length ? "— válassz a korábbi fogáshelyek közül —" : "— még nincs korábbi fogáshely —"}</option>` +
      state.places.map((p, i) => `<option value="${i}">${esc(p.water)}${p.spot ? " – " + esc(p.spot) : ""} (${p.n}×)</option>`).join("");
  }

  function onPlacePicked() {
    const sel = $("#prevPlaces");
    const p = state.places && state.places[Number(sel.value)];
    sel.value = "";
    if (!p) return;
    setLocation({ lat: p.lat, lon: p.lon, acc: null, source: "list" });
    const f = $("#catchForm");
    if (p.water) f.water.value = p.water;
    if (p.spot && !f.spot.value.trim()) f.spot.value = p.spot;
  }

  // Térképes kijelölés (Leaflet + OpenStreetMap; internet kell hozzá)
  let lmap = null, lmarker = null, pick = null;
  function openMap() {
    if (!window.L) { toast("A térkép nem töltődött be. Ellenőrizd az internetkapcsolatot."); return; }
    if (!navigator.onLine) { toast("A térképhez internetkapcsolat kell. Offline a korábbi helyek közül választhatsz."); return; }
    $("#mapModal").classList.remove("hidden");
    const last = state.catches.find((c) => c.lat != null);
    const center = state.gps ? [state.gps.lat, state.gps.lon] : last ? [last.lat, last.lon] : [47.16, 19.5];
    const zoom = state.gps ? 15 : last ? 12 : 7;
    if (!lmap) {
      lmap = L.map("mapCanvas", { zoomControl: true });
      L.tileLayer(CFG.MAP_TILES || "https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> közreműködők'
      }).addTo(lmap);
      lmap.on("click", (e) => setPick(e.latlng.lat, e.latlng.lng));
    }
    lmap.setView(center, zoom);
    pick = null;
    if (lmarker) { lmarker.remove(); lmarker = null; }
    if (state.gps) setPick(state.gps.lat, state.gps.lon);
    else { $("#mapInfo").textContent = "Még nincs kijelölve."; $("#btnMapOk").disabled = true; }
    setTimeout(() => lmap.invalidateSize(), 50);
  }

  function setPick(lat, lon) {
    pick = { lat, lon };
    if (lmarker) lmarker.setLatLng([lat, lon]);
    else lmarker = L.marker([lat, lon]).addTo(lmap);
    $("#mapInfo").textContent = `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
    $("#btnMapOk").disabled = false;
  }

  function mapLocate() {
    if (!("geolocation" in navigator)) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => { setPick(pos.coords.latitude, pos.coords.longitude); lmap.setView([pos.coords.latitude, pos.coords.longitude], 16); },
      () => toast("Nem sikerült pozíciót kapni."),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 }
    );
  }

  function closeMap(ok) {
    if (ok && pick) setLocation({ lat: pick.lat, lon: pick.lon, acc: null, source: "map" });
    $("#mapModal").classList.add("hidden");
  }

  // ------------------------------------------------------------------
  // Mentés: új fogás vagy meglévő szerkesztése
  // ------------------------------------------------------------------
  function readForm() {
    const f = $("#catchForm");
    const species = f.species.value.trim();
    const water = f.water.value.trim();
    const pr = parseCatchTime();
    if (pr.error) return { error: pr.error };
    const when = localInputValue(pr.date);
    if (!species || !water || !when) return { error: "A halfaj, az időpont és a vízterület kitöltése kötelező." };
    const caughtAt = new Date(when);
    if (isNaN(caughtAt)) return { error: "Érvénytelen időpont." };
    if (caughtAt.getTime() > Date.now() + 10 * 60 * 1000) return { error: "Az időpont nem lehet a jövőben." };
    const num = (v) => (v === "" || v == null ? null : Number(String(v).replace(",", ".")));
    return {
      data: {
        caught_at: caughtAt.toISOString(),
        species,
        weight_kg: num(f.weight_kg.value),
        length_cm: num(f.length_cm.value),
        water,
        spot: f.spot.value.trim() || null,
        bait: f.bait.value.trim() || null,
        method: f.method.value || null,
        released: f.released.checked,
        note: f.note.value.trim() || null,
        lat: state.gps ? state.gps.lat : null,
        lon: state.gps ? state.gps.lon : null,
        accuracy_m: state.gps && state.gps.acc ? Math.round(state.gps.acc) : null
      }
    };
  }

  async function onSave(ev) {
    ev.preventDefault();
    const msg = $("#saveMsg");
    msg.className = "msg";
    const r = readForm();
    if (r.error) { msg.className = "msg err"; msg.textContent = r.error; return; }
    if (state.editing) return saveEdit(r.data);

    const item = Object.assign({
      client_id: uuid(),
      user_id: state.uid,
      photo: state.photo && state.photo.blob ? state.photo.blob : null,
      photo_path: null,
      weather: undefined,
      created_local: new Date().toISOString()
    }, r.data);

    try {
      await idb.put("outbox", item);
      state.outbox.push(item);
      updateNet();
      fillDatalists();
      toast(navigator.onLine ? "Mentve, feltöltés folyamatban…" : "Mentve a telefonra. A kapcsolat helyreállása után feltöltődik.");
      resetForm();
      syncOutbox();
    } catch (e) {
      msg.className = "msg err";
      msg.textContent = "A mentés nem sikerült: " + errText(e);
    }
  }

  // Meglévő fogás betöltése szerkesztésre
  async function startEdit(clientId) {
    const pending = state.outbox.find((x) => x.client_id === clientId);
    const synced = state.catches.find((x) => x.client_id === clientId);
    const c = pending || synced;
    if (!c) return;
    const isAdmin = !!(state.me && state.me.is_admin);
    if (c.user_id !== state.uid && !(isAdmin && !pending)) { toast("Csak a saját fogásodat szerkesztheted."); return; }
    if (!pending && !navigator.onLine) { toast("A már feltöltött fogás szerkesztéséhez internetkapcsolat kell."); return; }

    resetForm(true);
    state.editing = { client_id: clientId, pending: !!pending, original: Object.assign({}, c) };
    const f = $("#catchForm");
    f.species.value = c.species || "";
    f.weight_kg.value = c.weight_kg != null ? c.weight_kg : "";
    f.length_cm.value = c.length_cm != null ? c.length_cm : "";
    setCatchTime(new Date(c.caught_at));
    f.water.value = c.water || "";
    f.spot.value = c.spot || "";
    f.bait.value = c.bait || "";
    f.method.value = c.method || "";
    f.released.checked = !!c.released;
    f.note.value = c.note || "";
    setLocation(c.lat != null ? { lat: Number(c.lat), lon: Number(c.lon), acc: c.accuracy_m, source: "saved" } : null);

    // Meglévő fotó megjelenítése
    let url = null;
    if (pending && c.photo) url = URL.createObjectURL(c.photo);
    else if (c.photo_path) url = await signedUrl(c.photo_path);
    if (url || c.photo_path) {
      state.photo = { existing: true, url };
      if (url) { $("#photoPreview").src = url; $("#photoPreview").classList.remove("hidden"); $("#photoEmpty").classList.add("hidden"); }
      $("#btnPhotoRemove").classList.remove("hidden");
    }

    $("#formTitle").textContent = "Fogás szerkesztése";
    $("#btnCancelEdit").classList.remove("hidden");
    $("#btnSave").textContent = "Módosítás mentése";
    f.classList.add("editing");
    const info = $("#editInfo");
    info.textContent = `Rögzítette: ${nameOf(c.user_id)}` + (c.updated_at ? ` · utoljára módosítva: ${dtFmt(c.updated_at)}` : "");
    info.classList.remove("hidden");
    checkLateTime();
    $("#lateWarn").classList.add("hidden");
    showTab("tabNew");
  }

  function cancelEdit() {
    resetForm();
    showTab("tabLog");
  }

  async function saveEdit(data) {
    const ed = state.editing;
    const o = ed.original;
    const msg = $("#saveMsg");
    const btn = $("#btnSave");
    const newPhoto = state.photo && state.photo.blob ? state.photo.blob : null;
    const removePhoto = !!state.photoRemoved && !newPhoto;
    const sameTime = new Date(o.caught_at).getTime() === new Date(data.caught_at).getTime();
    const samePlace = (o.lat == null && data.lat == null) ||
      (o.lat != null && data.lat != null && Math.abs(o.lat - data.lat) < 1e-6 && Math.abs(o.lon - data.lon) < 1e-6);
    const weatherStale = !(sameTime && samePlace);

    btn.disabled = true;
    msg.className = "msg"; msg.textContent = "Mentés…";
    try {
      if (ed.pending) {
        // Még fel nem töltött fogás: helyben módosítjuk, a feltöltés később történik
        const item = state.outbox.find((x) => x.client_id === ed.client_id);
        if (!item) throw new Error("A fogás közben feltöltődött. Nyisd meg újra a szerkesztést a naplóból.");
        Object.assign(item, data);
        if (newPhoto) { item.photo = newPhoto; item.photo_path = null; }
        if (removePhoto) { item.photo = null; item.photo_path = null; }
        if (weatherStale) item.weather = undefined;
        await idb.put("outbox", item);
        toast("Módosítás mentve.");
        resetForm();
        showTab("tabLog");
        syncOutbox();
        return;
      }

      if (!navigator.onLine) throw new Error("Nincs internetkapcsolat. A módosítás nem került mentésre.");
      const row = Object.assign({}, data);
      if (weatherStale) {
        row.weather = null;
        if (row.lat != null) {
          try { row.weather = await fetchWeather(row.lat, row.lon, row.caught_at); }
          catch (we) { console.warn(we); toast("Az időjárási adat most nem kérhető le; a fogás időjárás nélkül módosult."); }
        }
      }
      let oldPath = null;
      if (newPhoto) {
        const type = newPhoto.type || "image/jpeg";
        const ext = ({ "image/png": "png", "image/webp": "webp", "image/heic": "heic", "image/heif": "heif" })[type] || "jpg";
        const path = `${o.user_id}/${o.client_id}-${Date.now()}.${ext}`;
        const { error: upErr } = await state.sb.storage.from("photos").upload(path, newPhoto, { contentType: type, upsert: true });
        if (upErr) throw upErr;
        row.photo_path = path;
        oldPath = o.photo_path;
      } else if (removePhoto) {
        row.photo_path = null;
        oldPath = o.photo_path;
      }
      row.updated_at = new Date().toISOString();
      row.updated_by = state.uid;

      let { data: upd, error } = await state.sb.from("catches").update(row).eq("client_id", o.client_id).select("client_id");
      if (error && /updated_(at|by)/.test(error.message || "")) {
        // A 2. verziós adatbázis-frissítés még nem futott le: módosítás a régi oszlopokkal
        delete row.updated_at; delete row.updated_by;
        ({ data: upd, error } = await state.sb.from("catches").update(row).eq("client_id", o.client_id).select("client_id"));
      }
      if (error) throw error;
      if (!upd || !upd.length) throw new Error("Nincs jogosultságod ennek a fogásnak a módosításához.");
      if (oldPath) state.sb.storage.from("photos").remove([oldPath]).catch(() => {});
      toast("Módosítás mentve.");
      resetForm();
      await refreshData();
      showTab("tabLog");
    } catch (e) {
      msg.className = "msg err";
      msg.textContent = "A módosítás nem sikerült: " + errText(e);
    } finally {
      btn.disabled = false;
    }
  }

  // ------------------------------------------------------------------
  // Időjárás (Open-Meteo)
  // ------------------------------------------------------------------
  async function fetchWeather(lat, lon, iso) {
    const t = new Date(new Date(iso).getTime() + 30 * 60 * 1000); // legközelebbi egész óra
    const p = tzParts(t);
    const day = `${p.y}-${p.m}-${p.d}`;
    const prev = tzParts(new Date(t.getTime() - 24 * 3600 * 1000));
    const prevDay = `${prev.y}-${prev.m}-${prev.d}`;
    const ageDays = (Date.now() - t.getTime()) / 86400000;
    const base = ageDays > 80 ? "https://archive-api.open-meteo.com/v1/archive" : "https://api.open-meteo.com/v1/forecast";
    const params = new URLSearchParams({
      latitude: lat.toFixed(4),
      longitude: lon.toFixed(4),
      hourly: "temperature_2m,pressure_msl,wind_speed_10m,wind_direction_10m,cloud_cover,precipitation,weather_code",
      timezone: TZ,
      wind_speed_unit: "kmh",
      start_date: prevDay,
      end_date: day
    });
    const res = await fetch(`${base}?${params}`);
    if (!res.ok) throw new Error("Időjárás-lekérés hiba: " + res.status);
    const j = await res.json();
    const H = j.hourly;
    const key = `${day}T${p.h}:00`;
    const i = H && H.time ? H.time.indexOf(key) : -1;
    if (i < 0) throw new Error("Nincs időjárási adat erre az időpontra.");
    const val = (arr, k) => (arr && arr[k] != null ? arr[k] : null);
    const pNow = val(H.pressure_msl, i);
    const p3 = i >= 3 ? val(H.pressure_msl, i - 3) : null;
    const code = val(H.weather_code, i);
    return {
      source: "Open-Meteo",
      time: key,
      temp_c: val(H.temperature_2m, i),
      pressure_hpa: pNow,
      pressure_trend_3h: pNow != null && p3 != null ? Math.round((pNow - p3) * 10) / 10 : null,
      wind_kmh: val(H.wind_speed_10m, i),
      wind_dir_deg: val(H.wind_direction_10m, i),
      cloud_pct: val(H.cloud_cover, i),
      precip_mm: val(H.precipitation, i),
      code,
      desc: code != null ? (WMO[code] || `kód ${code}`) : null
    };
  }

  const WIND_DIRS = ["É", "ÉÉK", "ÉK", "KÉK", "K", "KDK", "DK", "DDK", "D", "DDNy", "DNy", "NyDNy", "Ny", "NyÉNy", "ÉNy", "ÉÉNy"];
  const windDir = (deg) => (deg == null ? "" : WIND_DIRS[Math.round(deg / 22.5) % 16]);

  // Holdfázis számítása (Meeus-féle közelítés a legközelebbi újholdra korrekciókkal)
  function moonInfo(date) {
    const SYN = 29.530588853;
    const jd = date.getTime() / 86400000 + 2440587.5;
    const rad = Math.PI / 180;
    // Meeus 49. fejezet: k-adik újhold ideje
    function newMoonJD(k) {
      const T = k / 1236.85;
      let JDE = 2451550.09766 + 29.530588861 * k + 0.00015437 * T * T - 0.00000015 * T * T * T + 0.00000000073 * T ** 4;
      const E = 1 - 0.002516 * T - 0.0000074 * T * T;
      const M = (2.5534 + 29.1053567 * k - 0.0000014 * T * T) * rad;
      const Mp = (201.5643 + 385.81693528 * k + 0.0107582 * T * T + 0.00001238 * T ** 3) * rad;
      const F = (160.7108 + 390.67050284 * k - 0.0016118 * T * T) * rad;
      const Om = (124.7746 - 1.56375588 * k + 0.0020672 * T * T) * rad;
      JDE += -0.4072 * Math.sin(Mp) + 0.17241 * E * Math.sin(M) + 0.01608 * Math.sin(2 * Mp) + 0.01039 * Math.sin(2 * F)
        + 0.00739 * E * Math.sin(Mp - M) - 0.00514 * E * Math.sin(Mp + M) + 0.00208 * E * E * Math.sin(2 * M)
        - 0.00111 * Math.sin(Mp - 2 * F) - 0.00057 * Math.sin(Mp + 2 * F) + 0.00056 * E * Math.sin(2 * Mp + M)
        - 0.00042 * Math.sin(3 * Mp) + 0.00042 * E * Math.sin(M + 2 * F) + 0.00038 * E * Math.sin(M - 2 * F)
        - 0.00024 * E * Math.sin(2 * Mp - M) - 0.00017 * Math.sin(Om);
      return JDE - 69 / 86400; // TT → UT (kb.)
    }
    let k = Math.floor((jd - 2451550.09766) / SYN);
    let nm = newMoonJD(k);
    if (nm > jd) { k--; nm = newMoonJD(k); }
    let next = newMoonJD(k + 1);
    if (next <= jd) { k++; nm = next; next = newMoonJD(k + 1); }
    const age = jd - nm;
    const len = next - nm;
    const f = age / len;
    const illum = Math.round((1 - Math.cos(2 * Math.PI * f)) / 2 * 100);
    const names = ["Újhold", "Növekvő sarló", "Első negyed", "Növekvő hold", "Telihold", "Fogyó hold", "Utolsó negyed", "Fogyó sarló"];
    const icons = ["🌑", "🌒", "🌓", "🌔", "🌕", "🌖", "🌗", "🌘"];
    const idx = Math.floor(f * 8 + 0.5) % 8;
    return { name: names[idx], icon: icons[idx], age_days: Math.round(age * 10) / 10, illum_pct: illum, idx };
  }
  const MOON_NAMES = ["Újhold", "Növekvő sarló", "Első negyed", "Növekvő hold", "Telihold", "Fogyó hold", "Utolsó negyed", "Fogyó sarló"];

  function weatherLine(w) {
    if (!w) return "";
    const parts = [];
    if (w.desc) parts.push(w.desc);
    if (w.temp_c != null) parts.push(`${numFmt(w.temp_c, 1)} °C`);
    if (w.pressure_hpa != null) {
      let s = `légnyomás ${numFmt(w.pressure_hpa, 0)} hPa`;
      if (w.pressure_trend_3h != null) {
        const t = w.pressure_trend_3h;
        s += t > 0.5 ? " ↑" : t < -0.5 ? " ↓" : " →";
      }
      parts.push(s);
    }
    if (w.wind_kmh != null) parts.push(`szél ${windDir(w.wind_dir_deg)} ${numFmt(w.wind_kmh, 0)} km/h`);
    if (w.cloud_pct != null) parts.push(`felhő ${numFmt(w.cloud_pct, 0)}%`);
    if (w.precip_mm) parts.push(`csapadék ${numFmt(w.precip_mm, 1)} mm`);
    return parts.join(" · ");
  }

  // ------------------------------------------------------------------
  // Szinkronizálás
  // ------------------------------------------------------------------
  async function syncOutbox() {
    if (state.syncing || !navigator.onLine || !state.sb || !state.uid) return;
    const { data } = await state.sb.auth.getSession().catch(() => ({ data: {} }));
    if (!data || !data.session) return;
    const items = state.outbox.filter((x) => x.user_id === state.uid);
    if (!items.length) return;

    state.syncing = true;
    updateNet();
    let ok = 0, failed = 0, lastErr = null;

    for (const item of items) {
      try {
        // 1. Fotó feltöltése
        if (item.photo && !item.photo_path) {
          const type = item.photo.type || "image/jpeg";
          const ext = ({ "image/png": "png", "image/webp": "webp", "image/heic": "heic", "image/heif": "heif" })[type] || "jpg";
          const path = `${state.uid}/${item.client_id}.${ext}`;
          const { error } = await state.sb.storage.from("photos")
            .upload(path, item.photo, { contentType: type, upsert: true });
          if (error) throw error;
          item.photo_path = path;
          await idb.put("outbox", item);
        }
        // 2. Időjárás (ha van pozíció). Ha nem sikerül, a fogás attól még felkerül.
        if (item.weather === undefined) {
          if (item.lat != null && item.lon != null) {
            try { item.weather = await fetchWeather(item.lat, item.lon, item.caught_at); }
            catch (we) { console.warn(we); item.weather = null; }
          } else {
            item.weather = null;
          }
          await idb.put("outbox", item);
        }
        // 3. Fogás rögzítése (a client_id miatt duplán nem kerülhet fel)
        const row = {
          client_id: item.client_id,
          user_id: item.user_id,
          caught_at: item.caught_at,
          species: item.species,
          weight_kg: item.weight_kg,
          length_cm: item.length_cm,
          water: item.water,
          spot: item.spot,
          bait: item.bait,
          method: item.method,
          released: item.released,
          note: item.note,
          lat: item.lat,
          lon: item.lon,
          accuracy_m: item.accuracy_m,
          photo_path: item.photo_path,
          weather: item.weather
        };
        const { error } = await state.sb.from("catches")
          .upsert(row, { onConflict: "client_id", ignoreDuplicates: true });
        if (error) throw error;

        await idb.del("outbox", item.client_id);
        state.outbox = state.outbox.filter((x) => x.client_id !== item.client_id);
        ok++;
      } catch (e) {
        failed++; lastErr = e;
        console.warn("Szinkron hiba:", e);
      }
      updateNet();
    }

    state.syncing = false;
    updateNet();
    if (ok) { toast(`${ok} fogás feltöltve.`); await refreshData(); }
    if (failed) toast(`${failed} fogás feltöltése nem sikerült: ${errText(lastErr)}. Később újrapróbálom.`, 5000);
  }

  // ------------------------------------------------------------------
  // Napló
  // ------------------------------------------------------------------
  function allEntries() {
    const pending = state.outbox
      .filter((x) => x.user_id === state.uid)
      .map((x) => Object.assign({}, x, { _pending: true }));
    const synced = state.catches.filter((c) => !pending.some((p) => p.client_id === c.client_id));
    return pending.concat(synced).sort((a, b) => (a.caught_at < b.caught_at ? 1 : -1));
  }

  const nameOf = (uid) => (state.profiles[uid] && state.profiles[uid].display_name) ||
    (uid === state.uid && state.me ? state.me.display_name : "Ismeretlen");

  function fillSelect(sel, values, allLabel, keep = true) {
    const cur = sel.value;
    sel.innerHTML = `<option value="">${esc(allLabel)}</option>` +
      values.map((v) => `<option value="${esc(v.value)}">${esc(v.label)}</option>`).join("");
    if (keep && values.some((v) => v.value === cur)) sel.value = cur;
  }

  function yearOptions(entries) {
    return Array.from(new Set(entries.map((c) => yearOf(c.caught_at)))).sort().reverse()
      .map((y) => ({ value: y, label: y }));
  }

  function filteredEntries() {
    const y = $("#fYear").value, u = $("#fUser").value, w = $("#fWater").value, s = $("#fSpecies").value;
    return allEntries().filter((c) =>
      (!y || yearOf(c.caught_at) === y) &&
      (!u || c.user_id === u) &&
      (!w || c.water === w) &&
      (!s || c.species === s));
  }

  async function signedUrl(path) {
    const hit = state.signedUrls[path];
    if (hit && hit.exp > Date.now()) return hit.url;
    if (!navigator.onLine) return null;
    const { data, error } = await state.sb.storage.from("photos").createSignedUrl(path, 3600);
    if (error || !data) return null;
    state.signedUrls[path] = { url: data.signedUrl, exp: Date.now() + 50 * 60 * 1000 };
    return data.signedUrl;
  }

  function renderLog() {
    const entries = allEntries();
    const uniqSorted = (arr) => Array.from(new Set(arr.filter(Boolean))).sort((a, b) => a.localeCompare(b, "hu"));
    fillSelect($("#fYear"), yearOptions(entries), "Minden év");
    fillSelect($("#fUser"),
      Array.from(new Set(entries.map((c) => c.user_id))).map((id) => ({ value: id, label: nameOf(id) }))
        .sort((a, b) => a.label.localeCompare(b.label, "hu")), "Minden horgász");
    fillSelect($("#fWater"), uniqSorted(entries.map((c) => c.water)).map((v) => ({ value: v, label: v })), "Minden vízterület");
    fillSelect($("#fSpecies"), uniqSorted(entries.map((c) => c.species)).map((v) => ({ value: v, label: v })), "Minden halfaj");

    const list = filteredEntries();
    $("#logCount").textContent = `${list.length} fogás`;
    const out = $("#logList");
    if (!list.length) { out.innerHTML = `<div class="card empty">Nincs megjeleníthető fogás.</div>`; return; }

    out.innerHTML = list.map((c) => {
      const size = [c.weight_kg != null ? `${numFmt(c.weight_kg)} kg` : "", c.length_cm != null ? `${numFmt(c.length_cm, 1)} cm` : ""]
        .filter(Boolean).join(", ");
      const tags = [
        c._pending ? `<span class="tag pending">Feltöltésre vár</span>` : "",
        c.released ? `<span class="tag">Visszaengedve</span>` : "",
        c.updated_at ? `<span class="tag" title="${esc(dtFmt(c.updated_at))}">Módosítva</span>` : ""
      ].join("");
      const meta = [nameOf(c.user_id), dtFmt(c.caught_at)].join(" · ");
      const where = [c.water, c.spot].filter(Boolean).join(" – ");
      const how = [c.bait, c.method].filter(Boolean).join(" · ");
      const own = c.user_id === state.uid;
      const canEdit = own || (!c._pending && state.me && state.me.is_admin);
      const map = c.lat != null ? `<a href="https://www.google.com/maps?q=${c.lat},${c.lon}" target="_blank" rel="noopener">Térkép</a>` : "";
      const hasPhoto = c._pending ? !!c.photo : !!c.photo_path;
      return `
        <div class="card catch" data-id="${esc(c.client_id)}">
          <div class="catch-photo" data-photo="${hasPhoto ? "1" : ""}">${hasPhoto ? "" : "🐟"}</div>
          <div>
            <div class="catch-title">${esc(c.species)}${size ? " – " + esc(size) : ""}</div>
            <div class="catch-meta">${esc(meta)}</div>
            <div class="catch-meta">${esc(where)}</div>
            ${how ? `<div class="catch-meta">${esc(how)}</div>` : ""}
            ${c.note ? `<div class="catch-meta"><em>${esc(c.note)}</em></div>` : ""}
            ${c.weather ? `<div class="catch-wx">🌤 ${esc(weatherLine(c.weather))}</div>` : ""}
            ${(() => { const mo = moonInfo(new Date(c.caught_at)); return `<div class="catch-wx">${mo.icon} ${esc(mo.name)} · megvilágítottság kb. ${mo.illum_pct}%</div>`; })()}
            <div style="margin-top:4px">${tags}</div>
            <div class="catch-actions">
              ${map}
              ${canEdit ? `<button type="button" class="link btn-edit" data-id="${esc(c.client_id)}">Szerkesztés</button>` : ""}
              ${canEdit ? `<button type="button" class="link btn-del" data-id="${esc(c.client_id)}">Törlés</button>` : ""}
            </div>
          </div>
        </div>`;
    }).join("");

    // Fotók betöltése
    list.forEach(async (c) => {
      const box = out.querySelector(`.catch[data-id="${CSS.escape(c.client_id)}"] .catch-photo`);
      if (!box || !box.dataset.photo) return;
      let url = null;
      if (c._pending && c.photo) url = URL.createObjectURL(c.photo);
      else if (c.photo_path) url = await signedUrl(c.photo_path);
      if (!url) { box.textContent = "📷"; return; }
      const img = document.createElement("img");
      img.className = "catch-photo";
      img.alt = c.species;
      img.loading = "lazy";
      img.src = url;
      img.addEventListener("click", () => { $("#photoModalImg").src = url; $("#photoModal").classList.remove("hidden"); });
      box.replaceWith(img);
    });
  }

  async function deleteEntry(clientId) {
    const pending = state.outbox.find((x) => x.client_id === clientId);
    if (!confirm("Biztosan törlöd ezt a fogást? A törlés nem vonható vissza.")) return;
    try {
      if (pending) {
        await idb.del("outbox", clientId);
        state.outbox = state.outbox.filter((x) => x.client_id !== clientId);
      } else {
        if (!navigator.onLine) { toast("Törléshez internetkapcsolat szükséges."); return; }
        const c = state.catches.find((x) => x.client_id === clientId);
        const { data: del, error } = await state.sb.from("catches").delete().eq("client_id", clientId).select("client_id");
        if (error) throw error;
        if (!del || !del.length) throw new Error("Nincs jogosultságod ennek a fogásnak a törléséhez.");
        if (c && c.photo_path) await state.sb.storage.from("photos").remove([c.photo_path]).catch(() => {});
        state.catches = state.catches.filter((x) => x.client_id !== clientId);
        await idb.put("kv", state.catches, "catches");
      }
      updateNet();
      renderLog();
      toast("Törölve.");
    } catch (e) {
      toast("A törlés nem sikerült: " + errText(e));
    }
  }

  // Excel-kompatibilis CSV (pontosvessző, tizedesvessző, UTF-8 BOM)
  function exportCsv() {
    const list = filteredEntries();
    if (!list.length) { toast("Nincs exportálható adat."); return; }
    const n = (v, d = 2) => (v == null ? "" : numFmt(v, d).replace(/\s/g, ""));
    const head = ["Időpont", "Horgász", "Halfaj", "Súly (kg)", "Hossz (cm)", "Vízterület", "Helyszín", "Csali",
      "Módszer", "Visszaengedve", "Megjegyzés", "Szélesség", "Hosszúság", "Hőmérséklet (°C)", "Légnyomás (hPa)",
      "Nyomásváltozás 3 óra (hPa)", "Szél (km/h)", "Szélirány", "Felhőzet (%)", "Csapadék (mm)", "Időjárás", "Holdfázis", "Hold megvilágítottság (%)", "Állapot"];
    const rows = list.map((c) => {
      const w = c.weather || {};
      const mo = moonInfo(new Date(c.caught_at));
      return [dtFmt(c.caught_at), nameOf(c.user_id), c.species, n(c.weight_kg), n(c.length_cm, 1), c.water, c.spot,
        c.bait, c.method, c.released ? "igen" : "nem", c.note,
        c.lat != null ? String(c.lat).replace(".", ",") : "", c.lon != null ? String(c.lon).replace(".", ",") : "",
        n(w.temp_c, 1), n(w.pressure_hpa, 1), n(w.pressure_trend_3h, 1), n(w.wind_kmh, 1), windDir(w.wind_dir_deg),
        n(w.cloud_pct, 0), n(w.precip_mm, 1), w.desc || "", mo.name, mo.illum_pct, c._pending ? "feltöltésre vár" : "feltöltve"];
    });
    const cell = (v) => {
      const s = String(v ?? "");
      return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = "﻿" + [head].concat(rows).map((r) => r.map(cell).join(";")).join("\r\n");
    const p = tzParts(new Date());
    const fname = `horgasznaplo_${p.y}${p.m}${p.d}_${p.h}${p.min}.csv`;
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });

    // iPhone: a megosztás menün keresztül (Fájlok, Mail stb.), mert a telepített appból a letöltés nem megbízható
    if (IS_IOS && navigator.canShare) {
      const file = new File([blob], fname, { type: "text/csv" });
      if (navigator.canShare({ files: [file] })) {
        navigator.share({ files: [file], title: fname })
          .then(() => toast("Exportálva."))
          .catch((e) => { if (e && e.name !== "AbortError") toast("A megosztás nem sikerült: " + errText(e)); });
        return;
      }
    }

    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = fname;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    toast(`Letöltve: ${fname}`);
  }

  // ------------------------------------------------------------------
  // Összesítők
  // ------------------------------------------------------------------
  function renderStats() {
    const entries = allEntries();
    fillSelect($("#sYear"), yearOptions(entries), "Minden év");
    const y = $("#sYear").value;
    const mode = $("#sMode").value;
    const list = entries.filter((c) => !y || yearOf(c.caught_at) === y);
    const out = $("#statsOut");
    if (!list.length) { out.innerHTML = `<div class="card empty">Nincs adat.</div>`; return; }

    const w = (c) => (c.weight_kg == null ? 0 : Number(c.weight_kg));
    const group = (keyFn) => {
      const m = new Map();
      list.forEach((c) => {
        const k = keyFn(c);
        if (!m.has(k)) m.set(k, []);
        m.get(k).push(c);
      });
      return m;
    };
    const biggest = (arr) => arr.reduce((best, c) => (c.weight_kg != null && (!best || w(c) > w(best)) ? c : best), null);
    const table = (heads, rows) => `
      <div class="card table-wrap"><table class="stats-table">
        <thead><tr>${heads.map((h) => `<th class="${h.num ? "num" : ""}">${esc(h.t)}</th>`).join("")}</tr></thead>
        <tbody>${rows.map((r) => `<tr>${r.map((v, i) => `<td class="${heads[i].num ? "num" : ""}">${v}</td>`).join("")}</tr>`).join("")}</tbody>
      </table></div>`;

    if (mode === "user" || mode === "water" || mode === "species") {
      const keyFn = mode === "user" ? (c) => c.user_id : mode === "water" ? (c) => c.water : (c) => c.species;
      const label = mode === "user" ? nameOf : (k) => k;
      const rows = Array.from(group(keyFn).entries()).map(([k, arr]) => {
        const sum = arr.reduce((s, c) => s + w(c), 0);
        const b = biggest(arr);
        return { k: label(k), n: arr.length, sum, b, rel: arr.filter((c) => c.released).length };
      }).sort((a, b) => b.sum - a.sum || b.n - a.n);
      const first = mode === "user" ? "Horgász" : mode === "water" ? "Vízterület" : "Halfaj";
      const bigCell = (b) => (b ? `${numFmt(b.weight_kg)} kg<br><small>${esc(mode === "species" ? nameOf(b.user_id) : b.species)}</small>` : "–");
      out.innerHTML = table(
        [{ t: first }, { t: "Db", num: true }, { t: "Össz. kg", num: true }, { t: "Legnagyobb", num: true }, { t: "Vissza", num: true }],
        rows.map((r) => [esc(r.k), r.n, numFmt(r.sum), bigCell(r.b), r.rel])
      );
    } else if (mode === "records") {
      const rows = Array.from(group((c) => c.species).entries())
        .map(([sp, arr]) => ({ sp, b: biggest(arr) }))
        .filter((r) => r.b)
        .sort((a, b) => w(b.b) - w(a.b));
      out.innerHTML = rows.length ? table(
        [{ t: "Halfaj" }, { t: "Súly", num: true }, { t: "Horgász" }, { t: "Hely, idő" }],
        rows.map((r) => [esc(r.sp), `${numFmt(r.b.weight_kg)} kg${r.b.length_cm != null ? `<br><small>${numFmt(r.b.length_cm, 1)} cm</small>` : ""}`,
          esc(nameOf(r.b.user_id)), `${esc(r.b.water)}<br><small>${esc(dtFmt(r.b.caught_at))}</small>`])
      ) : `<div class="card empty">Nincs súllyal rögzített fogás.</div>`;
    } else if (mode === "moon") {
      const g = group((c) => moonInfo(new Date(c.caught_at)).idx);
      const rows = MOON_NAMES.map((nm, i) => {
        const arr = g.get(i) || [];
        const b = biggest(arr);
        return [esc(["🌑","🌒","🌓","🌔","🌕","🌖","🌗","🌘"][i] + " " + nm), arr.length, numFmt(arr.reduce((s, c) => s + w(c), 0)),
          b ? `${numFmt(b.weight_kg)} kg<br><small>${esc(b.species)}</small>` : "–"];
      });
      out.innerHTML = table([{ t: "Holdfázis" }, { t: "Db", num: true }, { t: "Össz. kg", num: true }, { t: "Legnagyobb", num: true }], rows);
    } else if (mode === "month") {
      const rows = Array.from(group((c) => monthOf(c.caught_at)).entries())
        .sort((a, b) => (a[0] < b[0] ? 1 : -1))
        .map(([m, arr]) => [esc(m), arr.length, numFmt(arr.reduce((s, c) => s + w(c), 0))]);
      out.innerHTML = table([{ t: "Hónap" }, { t: "Db", num: true }, { t: "Össz. kg", num: true }], rows);
    }
  }

  // ------------------------------------------------------------------
  // Tagok (admin)
  // ------------------------------------------------------------------
  async function showMembers() {
    show("viewMembers");
    const box = $("#memberList");
    box.innerHTML = `<p class="hint">Betöltés…</p>`;
    try {
      const { data, error } = await state.sb.from("profiles").select("id, display_name, approved, is_admin, created_at")
        .order("approved").order("created_at", { ascending: false });
      if (error) throw error;
      box.innerHTML = data.map((p) => `
        <div class="member">
          <div>${esc(p.display_name)}${p.is_admin ? " (admin)" : ""}
            <small>${p.approved ? "Jóváhagyva" : "Jóváhagyásra vár"} · regisztrált: ${esc(dtFmt(p.created_at))}</small>
          </div>
          ${p.id === state.uid ? "" : `<button type="button" class="btn small ${p.approved ? "danger" : "primary"}" data-member="${esc(p.id)}" data-ok="${p.approved ? "0" : "1"}">${p.approved ? "Letiltás" : "Jóváhagyás"}</button>`}
        </div>`).join("") || `<p class="hint">Nincs tag.</p>`;
    } catch (e) {
      box.innerHTML = `<p class="msg err">${esc(errText(e))}</p>`;
    }
  }

  async function setApproval(id, ok) {
    try {
      const { error } = await state.sb.rpc("set_member_approval", { member: id, ok });
      if (error) throw error;
      toast(ok ? "Tag jóváhagyva." : "Tag letiltva.");
      showMembers();
    } catch (e) {
      toast(errText(e));
    }
  }

  async function rename() {
    $("#menuPanel").classList.add("hidden");
    const name = prompt("Új megjelenített név:", state.me.display_name || "");
    if (name == null) return;
    const v = name.trim().slice(0, 40);
    if (!v) return;
    try {
      const { error } = await state.sb.from("profiles").update({ display_name: v }).eq("id", state.uid);
      if (error) throw error;
      state.me.display_name = v;
      await idb.put("kv", state.me, "me");
      $("#menuUser").textContent = v + (state.me.is_admin ? " (admin)" : "");
      toast("Név módosítva.");
      refreshData();
    } catch (e) {
      toast(errText(e));
    }
  }

  // ------------------------------------------------------------------
  // Eseménykezelők
  // ------------------------------------------------------------------
  function bindUi() {
    $$(".seg-btn").forEach((b) => b.addEventListener("click", () => setAuthMode(b.dataset.auth)));
    $("#authForm").addEventListener("submit", onAuthSubmit);
    $("#catchForm").addEventListener("submit", onSave);
    $("#photoCamera").addEventListener("change", onPhotoPicked);
    $("#photoGallery").addEventListener("change", onPhotoPicked);
    $("#btnPhotoRemove").addEventListener("click", () => {
      if (state.photo && state.photo.existing) state.photoRemoved = true;
      clearPhoto();
    });
    $("#btnGps").addEventListener("click", () => requestGps(false));
    $("#btnMap").addEventListener("click", openMap);
    $("#btnLocClear").addEventListener("click", () => setLocation(null));
    $("#prevPlaces").addEventListener("change", onPlacePicked);
    $("#btnMapClose").addEventListener("click", () => closeMap(false));
    $("#btnMapOk").addEventListener("click", () => closeMap(true));
    $("#btnMapLocate").addEventListener("click", mapLocate);
    $("#catchDate").addEventListener("input", formatDateInput);
    $("#catchTime").addEventListener("input", formatTimeInput);
    $("#catchDate").addEventListener("blur", () => syncCatchTime(false));
    $("#catchTime").addEventListener("blur", () => syncCatchTime(false));
    $$(".chip[data-shift]").forEach((b) => b.addEventListener("click", () => shiftCatchTime(b.dataset.shift)));
    $("#btnCancelEdit").addEventListener("click", cancelEdit);
    $("#btnForgot").addEventListener("click", forgotPassword);
    $("#newPassForm").addEventListener("submit", onNewPassword);
    $$("#bottomNav button").forEach((b) => b.addEventListener("click", () => showTab(b.dataset.tab)));
    ["#fYear", "#fUser", "#fWater", "#fSpecies"].forEach((s) => $(s).addEventListener("change", renderLog));
    ["#sYear", "#sMode"].forEach((s) => $(s).addEventListener("change", renderStats));
    $("#btnExport").addEventListener("click", exportCsv);
    $("#btnSync").addEventListener("click", () => syncOutbox());
    $("#btnRecheck").addEventListener("click", () => enterApp());
    $("#btnMembersBack").addEventListener("click", () => { show("viewMain"); });
    $("#btnMenu").addEventListener("click", (e) => { e.stopPropagation(); $("#menuPanel").classList.toggle("hidden"); });
    document.addEventListener("click", (e) => {
      if (!e.target.closest("#menuPanel") && !e.target.closest("#btnMenu")) $("#menuPanel").classList.add("hidden");
      const act = e.target.closest("[data-action]");
      if (act) {
        const a = act.dataset.action;
        if (a === "logout") logout();
        if (a === "rename") rename();
        if (a === "members") showMembers();
      }
      const del = e.target.closest(".btn-del");
      if (del) deleteEntry(del.dataset.id);
      const ed = e.target.closest(".btn-edit");
      if (ed) startEdit(ed.dataset.id);
      const mem = e.target.closest("[data-member]");
      if (mem) setApproval(mem.dataset.member, mem.dataset.ok === "1");
    });
    $("#photoModal").addEventListener("click", () => $("#photoModal").classList.add("hidden"));

    window.addEventListener("online", () => { updateNet(); syncOutbox(); refreshData(); });
    window.addEventListener("offline", updateNet);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && state.uid) { syncOutbox(); refreshData(); }
    });
    setInterval(() => { if (state.outbox.length) syncOutbox(); }, 60000);
  }

  start().catch((e) => {
    console.error(e);
    toast("Indítási hiba: " + errText(e), 6000);
  });
})();
