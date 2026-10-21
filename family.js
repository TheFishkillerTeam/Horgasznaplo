/* =====================================================================
   Horgásznapló – Családtagok nézőként (6. verzió)
   Meghívó QR-kóddal (15 perc) vagy linkkel e-mailben/üzenetben (48 óra),
   egyszer használható. A néző mindent lát, de semmit nem módosíthat.
   Tag: 1 napos hozzáférést ad, a saját meghívottjának +1 napot adhat.
   Admin: tetszőleges időtartam vagy korlátlan, bárkinél módosíthat.
   Az app.js hívja meg: window.TFTFamily(api)
   ===================================================================== */
window.TFTFamily = function (A) {
  "use strict";
  const { state, $, esc, dtFmt, toast, errText } = A;

  const F = { qr: null, timer: null, poll: null, viewers: [] };
  const isViewer = () => !!(state.me && state.me.role === "viewer");
  const isAdmin = () => !!(state.me && state.me.is_admin && state.me.role !== "viewer");
  const viewerValid = (p) => !!(p && p.approved && (!p.viewer_until || new Date(p.viewer_until).getTime() > Date.now()));
  const DUR = [
    { m: 1440, label: "1 nap", txt: "1 napra" },
    { m: 10080, label: "1 hét", txt: "1 hétre" },
    { m: 43200, label: "1 hónap", txt: "1 hónapra" },
    { m: null, label: "Korlátlan", txt: "korlátlan ideig" }
  ];
  const durText = (m) => (DUR.find((d) => d.m === m) || { txt: `${Math.round(m / 60)} órára` }).txt;
  const untilText = (p) => (!p.viewer_until ? "korlátlan" : dtFmt(p.viewer_until));
  const inviteUrl = (tok) => `${A.APP_URL}#meghivo-${tok}`;

  // ------------------------------------------------------------------
  // Meghívó fogadása (a családtag telefonján)
  // ------------------------------------------------------------------
  function readToken() {
    const m = location.hash.match(/^#meghivo-([0-9a-f]{32,64})$/i);
    if (m) {
      try { sessionStorage.setItem("inviteToken", m[1]); } catch (_) { /* nincs tároló */ }
      history.replaceState(history.state, "", location.pathname + location.search);
      return m[1];
    }
    try { return sessionStorage.getItem("inviteToken"); } catch (_) { return null; }
  }
  const clearToken = () => { try { sessionStorage.removeItem("inviteToken"); } catch (_) { /* nincs tároló */ } state.inviteToken = null; };

  // true: a meghívó képernyő jelent meg (az indítás itt megáll)
  async function handleInvite(session) {
    const tok = state.inviteToken;
    if (!tok) return false;
    if (session) {
      const { data } = await state.sb.from("profiles").select("*").eq("id", session.user.id).maybeSingle();
      if (data && data.role !== "viewer" && data.approved) {
        clearToken();
        toast("Már tag vagy, neked nem kell meghívó. A meghívót a családtagodnak kell megnyitnia.", 6000);
        return false;
      }
      showRedeem(data);
      return true;
    }
    showRedeem(null);
    return true;
  }

  function showRedeem(profile) {
    const signedIn = !!profile;
    $("#rdName").value = profile && profile.display_name && profile.display_name !== "Vendég" ? profile.display_name : "";
    $("#rdEmailToggle").classList.toggle("hidden", signedIn);
    $("#rdEmailBox").classList.add("hidden");
    $("#btnRedeemQuick").textContent = signedIn ? "Hozzáférés aktiválása" : "Belépés";
    $("#rdQuickHint").classList.toggle("hidden", signedIn);
    $("#rdMsg").textContent = "";
    A.show("viewRedeem");
  }

  async function redeem(kind) {
    const msg = $("#rdMsg");
    const name = $("#rdName").value.trim().slice(0, 40);
    const fail = (t) => { msg.className = "msg err"; msg.textContent = t; };
    if (!name && kind !== "login") return fail("Add meg a neved, hogy a többiek lássák, ki nézi a naplót.");
    if (!navigator.onLine) return fail("A belépéshez internetkapcsolat kell.");
    const btns = document.querySelectorAll("#viewRedeem button");
    btns.forEach((b) => { b.disabled = true; });
    msg.className = "msg"; msg.textContent = "Belépés…";
    state.redeeming = true;
    try {
      let { data: { session } } = await state.sb.auth.getSession();
      if (!session) {
        if (kind === "quick") {
          const r = await state.sb.auth.signInAnonymously();
          if (r.error) throw r.error;
          session = r.data.session;
        } else {
          const email = $("#rdEmail").value.trim(), password = $("#rdPass").value;
          if (!email || password.length < 8) throw new Error("Add meg az e-mail-címet és egy legalább 8 karakteres jelszót.");
          const r = kind === "register"
            ? await state.sb.auth.signUp({ email, password, options: { data: { display_name: name } } })
            : await state.sb.auth.signInWithPassword({ email, password });
          if (r.error) throw r.error;
          session = r.data.session;
          if (!session) throw new Error("Erősítsd meg az e-mail-címedet a kapott levélben, majd nyisd meg újra a meghívó linket.");
        }
      }
      state.uid = session.user.id;
      const { error } = await state.sb.rpc("redeem_invite", { tok: state.inviteToken, name: name || null });
      if (error) throw error;
      clearToken();
      state.redeeming = false;
      toast("Üdv a TFT Horgásznaplóban! Nézőként mindent megnézhetsz.", 5000);
      await A.enterApp();
    } catch (e) {
      state.redeeming = false;
      const m = (e && e.message) || "";
      if (/anonymous sign-ins are disabled|Anonymous sign-ins are disabled/i.test(m))
        fail("A gyors belépés még nincs bekapcsolva. Lépj be e-mail-címmel, vagy szólj a meghívónak.");
      else fail(errText(e));
    } finally {
      btns.forEach((b) => { b.disabled = false; });
    }
  }

  // ------------------------------------------------------------------
  // Lejárt hozzáférés
  // ------------------------------------------------------------------
  function showExpired() {
    const p = state.me || {};
    $("#expText").textContent = p.viewer_until
      ? `A hozzáférésed ${dtFmt(p.viewer_until)}-kor lejárt.`
      : "A hozzáférésed megszűnt.";
    A.show("viewExpired");
  }
  function checkExpiry() {
    if (isViewer() && !viewerValid(state.me) && $("#viewExpired").classList.contains("hidden") && !$("#viewMain").classList.contains("hidden")) showExpired();
  }

  // ------------------------------------------------------------------
  // Meghívás (tagok) – Családtagok fül
  // ------------------------------------------------------------------
  function stopQr() {
    clearInterval(F.timer); clearInterval(F.poll);
    F.timer = F.poll = null;
  }

  async function render() {
    const box = $("#familyOut");
    if (!box) return;
    if (isViewer()) { box.innerHTML = ""; return; }
    const adm = isAdmin();
    box.innerHTML = `
      <div class="card">
        <h2>Családtag meghívása</h2>
        <p class="hint">A családtag <b>nézőként</b> kap hozzáférést: mindent lát (fogások, fotók, túrák, rekordok), de nem rögzíthet, nem módosíthat és nem töröl semmit, értesítést sem kap.</p>
        ${adm ? `<label class="field">Hozzáférés időtartama
          <select id="invDur">${DUR.map((d, i) => `<option value="${i}"${i === 0 ? " selected" : ""}>${d.label}</option>`).join("")}</select></label>`
          : `<p class="hint">A hozzáférés <b>1 napra</b> szól. Utána egy nappal meghosszabbíthatod, az admin hosszabb időre is.</p>`}
        <div class="inv-btns">
          <button type="button" class="btn primary" data-inv="qr">📱 QR-kód megjelenítése</button>
          <button type="button" class="btn" data-inv="link">✉️ Meghívó e-mailben / üzenetben</button>
        </div>
        <div id="invPanel"></div>
      </div>
      <div class="card">
        <h3>${adm ? "Családtagok (nézők)" : "Meghívottaim"}</h3>
        <div id="viewerList"><p class="hint">Betöltés…</p></div>
      </div>`;
    loadViewers();
  }

  async function loadViewers() {
    const box = $("#viewerList");
    if (!box) return;
    try {
      const { data, error } = await state.sb.from("profiles").select("*").eq("role", "viewer");
      if (error) throw error;
      F.viewers = (data || []).filter((p) => isAdmin() || p.invited_by === state.uid)
        .sort((a, b) => (viewerValid(b) ? 1 : 0) - (viewerValid(a) ? 1 : 0) || String(b.invited_at || "").localeCompare(String(a.invited_at || "")));
      box.innerHTML = F.viewers.length ? F.viewers.map((p) => viewerRowHtml(p)).join("")
        : `<p class="hint">${isAdmin() ? "Még nincs néző." : "Még nem hívtál meg senkit."}</p>`;
    } catch (e) {
      box.innerHTML = `<p class="msg err">${esc(errText(e))}</p>`;
    }
  }

  // Egy néző sora (a Családtagok fülön és az admin Tagok listájában is)
  function viewerRowHtml(p) {
    const ok = viewerValid(p);
    const mine = p.invited_by === state.uid;
    const adm = isAdmin();
    const btn = (mode, label, cls) => `<button type="button" class="btn small${cls ? " " + cls : ""}" data-va="${mode}" data-vid="${esc(p.id)}">${label}</button>`;
    const acts = adm
      ? [btn("day", "+1 nap"), btn("week", "+1 hét"), btn("month", "+1 hónap"), p.viewer_until || !ok ? btn("unlimited", "Korlátlan") : "", ok ? btn("revoke", "Visszavonás", "danger") : ""]
      : mine ? [btn("day", "+1 nap"), ok ? btn("revoke", "Visszavonás", "danger") : ""] : [];
    return `<div class="viewer-row${ok ? "" : " expired"}">
      <div class="vr-main"><b>${esc(p.display_name || "Vendég")}</b> <span class="tag nezo">néző</span>
        <small>${ok ? `Aktív · ${p.viewer_until ? "lejár: " + esc(untilText(p)) : "korlátlan"}` : `Lejárt${p.viewer_until ? " · " + esc(untilText(p)) : ""}`}
          ${p.invited_by ? ` · meghívta: ${esc(A.nameOf(p.invited_by))}` : ""}${p.invited_at ? `, ${esc(dtFmt(p.invited_at))}` : ""}</small></div>
      ${acts.filter(Boolean).length ? `<div class="vr-acts">${acts.join("")}</div>` : ""}
    </div>`;
  }

  async function setAccess(id, mode) {
    if (mode === "revoke" && !confirm("Visszavonod a hozzáférését? Azonnal kiléptetjük a naplóból.")) return;
    try {
      const { error } = await state.sb.rpc("set_viewer_access", { member: id, mode });
      if (error) throw error;
      toast({ day: "+1 nap hozzáadva.", week: "+1 hét hozzáadva.", month: "+1 hónap hozzáadva.", unlimited: "Korlátlan hozzáférés beállítva.", revoke: "Hozzáférés visszavonva." }[mode] || "Kész.");
      loadViewers();
      if (!$("#viewMembers").classList.contains("hidden")) A.showMembers();
    } catch (e) { toast(errText(e), 5000); }
  }

  function chosenMinutes() {
    if (!isAdmin()) return 1440;
    const i = Number(($("#invDur") || {}).value || 0);
    return DUR[i] ? DUR[i].m : 1440;
  }

  async function createInvite(chan) {
    if (!navigator.onLine) { toast("A meghíváshoz internetkapcsolat kell."); return null; }
    const minutes = chosenMinutes();
    const { data, error } = await state.sb.rpc("create_invite", { chan, minutes });
    if (error) { toast(errText(error), 5000); return null; }
    return data;
  }

  async function showQr() {
    stopQr();
    const inv = await createInvite("qr");
    if (!inv) return;
    const url = inviteUrl(inv.token);
    const panel = $("#invPanel");
    let img = "";
    try {
      const qr = window.qrcode(0, "M");
      qr.addData(url);
      qr.make();
      img = `<img class="qr-img" alt="QR-kód a meghívóhoz" src="${qr.createDataURL(8, 4)}">`;
    } catch (e) { img = `<p class="msg err">A QR-kód nem készült el: ${esc(errText(e))}</p>`; }
    panel.innerHTML = `<div class="qr-box">
        ${img}
        <p class="qr-title">Olvastasd be a családtag telefonjának kamerájával</p>
        <p class="hint">Hozzáférés: ${esc(durText(inv.access_minutes))} · egyszer használható · érvényes még <b id="qrLeft">15:00</b></p>
        <p class="msg" id="qrStatus" role="status"></p>
        <div class="row-btns"><button type="button" class="btn small" data-inv="qr">Új kód</button><button type="button" class="btn small" data-inv="close">Bezárás</button></div>
      </div>`;
    const exp = new Date(inv.expires_at).getTime();
    const tick = () => {
      const left = Math.max(0, exp - Date.now());
      const el = $("#qrLeft");
      if (!el) { stopQr(); return; }
      el.textContent = `${String(Math.floor(left / 60000)).padStart(2, "0")}:${String(Math.floor(left / 1000) % 60).padStart(2, "0")}`;
      if (!left) { stopQr(); $("#qrStatus").className = "msg warn"; $("#qrStatus").textContent = "A kód lejárt – kérj újat az „Új kód” gombbal."; }
    };
    tick();
    F.timer = setInterval(tick, 1000);
    // Figyeljük, mikor váltják be
    F.poll = setInterval(async () => {
      if (!$("#qrStatus")) { stopQr(); return; }
      const { data } = await state.sb.from("invites").select("*").eq("token", inv.token).maybeSingle();
      if (data && data.used_at) {
        stopQr();
        let who = "A családtag";
        const { data: p } = await state.sb.from("profiles").select("*").eq("id", data.used_by).maybeSingle();
        if (p && p.display_name) who = p.display_name;
        $("#qrStatus").className = "msg ok";
        $("#qrStatus").textContent = `✓ ${who} belépett nézőként.`;
        const im = document.querySelector(".qr-img"); if (im) im.classList.add("used");
        loadViewers();
      }
    }, 4000);
  }

  async function shareLink() {
    stopQr();
    const inv = await createInvite("link");
    if (!inv) return;
    const url = inviteUrl(inv.token);
    const me = (state.me && state.me.display_name) || "Egy tag";
    const club = (A.CFG.CLUB_NAME || "TFT");
    const subject = `Meghívó – ${club} Horgásznapló`;
    const text = `Szia! ${me} meghívott a ${club} Horgásznaplójába nézőként (${durText(inv.access_minutes)}). Itt láthatod a fogásainkat, fotóinkat és túráinkat.\n\nA meghívó 48 óráig érvényes és egyszer használható – nyisd meg ezt a linket a telefonodon:\n${url}`;
    $("#invPanel").innerHTML = `<div class="link-box">
        <p class="hint">Meghívó link (48 óráig érvényes, egyszer használható):</p>
        <input class="link-in" readonly value="${esc(url)}" aria-label="Meghívó link">
        <div class="row-btns">
          <button type="button" class="btn small" data-inv="copy">Link másolása</button>
          <a class="btn small" href="mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}">E-mail írása</a>
          <button type="button" class="btn small" data-inv="close">Bezárás</button>
        </div>
      </div>`;
    F.lastLink = { url, text, subject };
    if (navigator.share) {
      try { await navigator.share({ title: subject, text }); } catch (e) { if (e && e.name !== "AbortError") toast(errText(e)); }
    }
    loadViewers();
  }

  async function copyLink() {
    try { await navigator.clipboard.writeText(F.lastLink ? F.lastLink.text : ""); toast("A meghívó szövege a linkkel a vágólapon."); }
    catch (_) { const i = document.querySelector(".link-in"); if (i) { i.select(); toast("Jelöld ki és másold a linket."); } }
  }

  // ------------------------------------------------------------------
  // Eseménykezelés
  // ------------------------------------------------------------------
  document.addEventListener("click", (e) => {
    const g = (sel) => e.target.closest(sel);
    let el;
    if ((el = g("[data-va]"))) { setAccess(el.dataset.vid, el.dataset.va); return; }
    if ((el = g("[data-inv]"))) {
      const k = el.dataset.inv;
      if (k === "qr") showQr();
      else if (k === "link") shareLink();
      else if (k === "copy") copyLink();
      else if (k === "close") { stopQr(); $("#invPanel").innerHTML = ""; }
      return;
    }
  });
  $("#btnRedeemQuick").addEventListener("click", () => redeem("quick"));
  $("#btnRedeemRegister").addEventListener("click", () => redeem("register"));
  $("#btnRedeemLogin").addEventListener("click", () => redeem("login"));
  $("#rdEmailToggle").addEventListener("click", () => $("#rdEmailBox").classList.toggle("hidden"));
  $("#btnExpRecheck").addEventListener("click", () => A.enterApp());
  setInterval(checkExpiry, 30000);

  return { readToken, handleInvite, showExpired, checkExpiry, render, stopQr, viewerRowHtml, viewerValid, isViewer };
};
