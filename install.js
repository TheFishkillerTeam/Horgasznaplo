/* =====================================================================
   Horgásznapló – „Telepítés alkalmazásként” gomb (8.0 verzió)
   - Android (Chrome, Edge, Samsung) és gépen Chrome/Edge: a rendszer saját
     telepítő kérdése (beforeinstallprompt)
   - iPhone/iPad: az Apple nem enged gombnyomásos telepítést → képes útmutató
   - Firefox, Viber/Facebook belső böngésző: útmutató / „nyisd meg böngészőben”
   - Telepített appban nem jelenik meg; „Később” után 14 napig nem kérdez
   Az app.js hívja meg: window.TFTInstall(api)
   ===================================================================== */
window.TFTInstall = function (A) {
  "use strict";
  const { $, toast } = A;
  const DISMISS_DAYS = 14;
  let deferred = null;
  const ls = { get: (k) => { try { return localStorage.getItem(k); } catch (_) { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (_) { /* nincs tároló */ } } };

  // Böngésző és rendszer felismerése (a pontos telefonmodell nem kell)
  function detect(uaIn) {
    const ua = uaIn || navigator.userAgent || "";
    const ios = /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && typeof navigator !== "undefined" && navigator.maxTouchPoints > 1);
    const android = /Android/i.test(ua);
    const inApp = /Viber|FBAN|FBAV|FB_IAB|Instagram|Messenger|Line\/|MicroMessenger|; wv\)/i.test(ua);
    const firefox = /Firefox|FxiOS/i.test(ua);
    const samsung = /SamsungBrowser/i.test(ua);
    const edge = /Edg(e|A|iOS)?\//i.test(ua);
    const chromeIos = /CriOS/i.test(ua);
    const os = ios ? "ios" : android ? "android" : "desktop";
    const browser = inApp ? "inapp" : firefox ? "firefox" : samsung ? "samsung" : edge ? "edge" : chromeIos || /Chrome\//.test(ua) ? "chrome" : /Safari\//.test(ua) ? "safari" : "other";
    return { os, browser, inApp };
  }
  const standalone = () => {
    try { if (window.matchMedia("(display-mode: standalone)").matches || window.matchMedia("(display-mode: fullscreen)").matches) return true; } catch (_) { /* régi böngésző */ }
    return navigator.standalone === true;
  };
  const dismissed = () => { const t = Number(ls.get("installDismissed") || 0); return t && Date.now() - t < DISMISS_DAYS * 86400000; };
  const shouldShow = () => !standalone() && !dismissed() && !ls.get("installDone");

  window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferred = e; refresh(); });
  window.addEventListener("appinstalled", () => { ls.set("installDone", "1"); deferred = null; refresh(); toast("Telepítve! Mostantól a kezdőképernyőről indíthatod. 🎣", 5000); });

  function cardHtml() {
    if (!shouldShow()) return "";
    const d = detect();
    const sub = d.inApp ? "A Viber / Facebook belső böngészőjéből nem lehet telepíteni – megmutatjuk, hogyan nyisd meg rendes böngészőben."
      : d.os === "ios" ? "Egy koppintás a kezdőképernyőről, és értesítést is kaphatsz (iPhone-on csak így)."
      : "Gyorsabb indulás a kezdőképernyőről, és értesítések.";
    return `<div class="card install-card" data-install-card>
      <div class="install-txt"><b>📲 Telepítsd alkalmazásként!</b><small>${sub}</small></div>
      <div class="install-btns"><button type="button" class="btn primary small" data-install-go>${d.inApp ? "Hogyan?" : "Telepítés"}</button>
      <button type="button" class="link" data-install-later>Később</button></div></div>`;
  }
  function refresh() {
    const slot = $("#installSlot");
    if (slot) slot.innerHTML = cardHtml();
    if (A.onChange) A.onChange();
  }

  const shareIcon = `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" class="ios-share"><path d="M12 3v12M7 8l5-5 5 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M6 11H5v10h14V11h-1" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>`;
  function guideHtml(d) {
    const steps = (arr) => `<ol class="inst-steps">${arr.map((s) => `<li>${s}</li>`).join("")}</ol>`;
    let title, body;
    if (d.inApp) {
      title = "Nyisd meg rendes böngészőben";
      body = `<p>A Viber (Facebook, Messenger) belső böngészőjéből nem lehet telepíteni.</p>` + steps([
        d.os === "ios" ? "Koppints a jobb felső / alsó <b>⋯</b> vagy <b>Megnyitás Safariban</b> gombra." : "Koppints a jobb felső <b>⋮</b> menüre → <b>Megnyitás böngészőben</b> (vagy Chrome-ban).",
        `Ha nincs ilyen gomb: másold ki a linket, és illeszd be ${d.os === "ios" ? "a Safariba" : "a Chrome-ba"}.`,
        "Ott koppints újra a <b>📲 Telepítés</b> gombra."]) +
        `<button type="button" class="btn small" data-install-copy>🔗 Link másolása</button>`;
    } else if (d.os === "ios") {
      title = "Telepítés iPhone-on / iPaden";
      body = `<p class="hint">Az Apple nem engedi, hogy egy weboldal gombnyomásra települjön, ezért 3 lépés kell:</p>` + steps([
        `Koppints a <b>Megosztás</b> gombra ${shareIcon} ${d.browser === "safari" ? "(Safariban <b>alul középen</b>, iPaden fent)" : "(Chrome-ban / Edge-ben <b>fent jobbra</b> a címsorban)"}.`,
        "Görgess le, és válaszd: <b>Főképernyőhöz adás</b> (Add to Home Screen).",
        "Koppints jobb fent: <b>Hozzáadás</b>. Kész – az app ikonja megjelenik a kezdőképernyőn."]) +
        (d.browser === "safari" ? `<div class="ios-arrow" aria-hidden="true">⬇</div>` : "");
    } else if (d.browser === "firefox") {
      title = "Telepítés Firefoxban";
      body = steps(["Koppints a <b>⋮</b> menüre (jobb fent vagy alul).", "Válaszd: <b>Telepítés</b> (vagy <b>Hozzáadás a kezdőképernyőhöz</b>).", "Erősítsd meg: <b>Hozzáadás</b>."]);
    } else {
      title = "Telepítés";
      body = steps([d.os === "desktop" ? "A címsor jobb szélén kattints a <b>telepítés</b> ikonra (⊕ vagy monitor ikon)." : "Koppints a böngésző <b>⋮</b> menüjére (jobb fent).",
        d.os === "desktop" ? "Válaszd: <b>Telepítés</b>." : "Válaszd: <b>Alkalmazás telepítése</b> vagy <b>Hozzáadás a kezdőképernyőhöz</b>.",
        "Erősítsd meg a <b>Telepítés</b> gombbal."]);
    }
    return `<div class="cel-card" role="dialog" aria-modal="true" aria-labelledby="instTitle"><div class="cel-body">
      <h2 id="instTitle">📲 ${title}</h2>${body}
      <button type="button" class="btn primary block" data-install-close>Rendben</button></div></div>`;
  }
  function showGuide(d) {
    let ov = $("#installOverlay");
    if (!ov) { ov = document.createElement("div"); ov.id = "installOverlay"; ov.className = "cel-overlay"; document.body.appendChild(ov); }
    ov.innerHTML = guideHtml(d);
    ov.classList.remove("hidden");
  }
  async function go() {
    const d = detect();
    if (deferred && !d.inApp) {
      const ev = deferred; deferred = null;
      try {
        ev.prompt();
        const ch = await ev.userChoice;
        if (ch && ch.outcome === "accepted") ls.set("installDone", "1");
      } catch (_) { showGuide(d); }
      refresh();
      return;
    }
    showGuide(d);
  }

  document.addEventListener("click", async (e) => {
    const g = (s) => e.target.closest(s);
    if (g("[data-install-go]")) { go(); return; }
    if (g("[data-install-later]")) { ls.set("installDismissed", String(Date.now())); refresh(); return; }
    if (g("[data-install-close]") || e.target.id === "installOverlay") { const ov = $("#installOverlay"); if (ov) ov.classList.add("hidden"); return; }
    if (g("[data-install-copy]")) {
      const url = location.href.split("#")[0];
      try { await navigator.clipboard.writeText(url); toast("Link kimásolva."); } catch (_) { prompt("Másold ki a linket:", url); }
    }
  });

  return { cardHtml, refresh, detect, shouldShow, _setDeferred: (x) => { deferred = x; refresh(); } };
};
