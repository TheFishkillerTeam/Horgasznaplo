/* =====================================================================
   Horgásznapló – Ünnepi köszöntés és „Ma volt…” (8.0 verzió)
   - Felugró ablak az app megnyitásakor (naponta egyszer): születésnap,
     névnap, karácsony, újév, húsvét, halloween – animált, változó grafikával
   - Kezdőlap: „📅 Ma volt…” emlékkártya, ünnepi sáv, hiányzó születésnap kérése
   - Születésnap / névnap megadása (a tag a sajátját, az admin bárkiét)
   - Admin: előnézet minden üzenetre
   Az app.js hívja meg: window.TFTCelebrateUI(api); a számítás a celebrate-core.js-ben.
   ===================================================================== */
window.TFTCelebrateUI = function (A) {
  "use strict";
  const { state, $, esc, toast, errText, numFmt, dtFmt } = A;
  const C = window.TFTCelebrate;
  const MONTHS = ["január", "február", "március", "április", "május", "június", "július", "augusztus", "szeptember", "október", "november", "december"];
  const isMember = () => !!(state.me && state.me.role !== "viewer");
  const isAdmin = () => !!(state.me && state.me.is_admin && state.me.role !== "viewer");
  const ls = { get: (k) => { try { return localStorage.getItem(k); } catch (_) { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (_) { /* nincs tároló */ } } };

  function ctxNow(date) {
    const profiles = Object.values(state.profiles || {});
    if (state.me && !profiles.some((p) => p.id === state.me.id)) profiles.push(state.me);
    const trips = A.trips ? A.trips() : [];
    return { date: date || C.bpDate(new Date()), profiles, trips, catches: A.entries(), nameOf: A.nameOf };
  }

  // ------------------------------------------------------------------
  // Grafikák (saját rajzok, animált SVG; csökkentett mozgásnál állóképek)
  // ------------------------------------------------------------------
  const confetti = (n, colors) => Array.from({ length: n }, (_, i) => {
    const x = (i * 37) % 300 + 10, d = 2.2 + (i % 5) * 0.45, delay = (i % 7) * 0.35, c = colors[i % colors.length], r = (i * 47) % 360;
    return `<rect class="cf" x="${x}" y="-12" width="7" height="11" rx="1.5" fill="${c}" transform="rotate(${r} ${x} 0)" style="animation-duration:${d}s;animation-delay:${delay}s"/>`;
  }).join("");
  const snow = (n) => Array.from({ length: n }, (_, i) => {
    const x = (i * 41) % 310 + 5, d = 4 + (i % 4), delay = (i % 6) * 0.6, s = 2 + (i % 3);
    return `<circle class="sn" cx="${x}" cy="-6" r="${s}" fill="#fff" opacity=".9" style="animation-duration:${d}s;animation-delay:${delay}s"/>`;
  }).join("");
  // A TFT hala (saját figura) – ünnepi kiegészítőkkel
  const fish = (x, y, s, extra) => `<g transform="translate(${x} ${y}) scale(${s})"><g class="fishy">
      <path d="M0 0c22-22 70-22 92 0-22 22-70 22-92 0z" fill="#2f9e8f"/><path d="M90 0l26-18v36z" fill="#238276"/>
      <circle cx="22" cy="-4" r="5" fill="#fff"/><circle cx="23" cy="-4" r="2.4" fill="#123"/>
      <path d="M40-12q12 12 0 24" stroke="#5cc3b4" stroke-width="3" fill="none"/>${extra || ""}</g></g>`;
  const ART = {
    birthday: [
      () => `<svg viewBox="0 0 320 200" class="art">
        <rect width="320" height="200" fill="#fff4e6"/>${confetti(28, ["#ff6b6b", "#fcc419", "#51cf66", "#339af0", "#cc5de8"])}
        <g class="balloon b1"><ellipse cx="60" cy="70" rx="22" ry="28" fill="#ff6b6b"/><path d="M60 98v60" stroke="#999"/></g>
        <g class="balloon b2"><ellipse cx="262" cy="62" rx="20" ry="26" fill="#339af0"/><path d="M262 88v70" stroke="#999"/></g>
        <rect x="110" y="120" width="100" height="56" rx="8" fill="#f783ac"/><rect x="110" y="120" width="100" height="14" rx="6" fill="#fff"/>
        <rect x="124" y="96" width="72" height="26" rx="6" fill="#ffd8a8"/>
        ${[136, 160, 184].map((x) => `<rect x="${x - 3}" y="78" width="6" height="18" fill="#74c0fc"/><path class="flame" d="M${x} 66c6 7 4 12 0 12s-6-5 0-12z" fill="#ff922b"/>`).join("")}
      </svg>`,
      () => `<svg viewBox="0 0 320 200" class="art">
        <rect width="320" height="200" fill="#e7f5ff"/>${confetti(26, ["#fa5252", "#fab005", "#40c057", "#7950f2"])}
        ${fish(110, 120, 1.05, `<path d="M18-20l12-34 14 32z" fill="#fcc419"/><circle cx="30" cy="-55" r="5" fill="#fa5252"/>`)}
        <g class="balloon b1"><ellipse cx="270" cy="60" rx="20" ry="26" fill="#fab005"/><path d="M270 86v80" stroke="#999"/></g>
        <text x="160" y="186" text-anchor="middle" font-size="16" font-weight="700" fill="#1864ab">Isten éltessen!</text>
      </svg>`
    ],
    nameday: [
      () => `<svg viewBox="0 0 320 200" class="art">
        <rect width="320" height="200" fill="#f3f0ff"/>${confetti(18, ["#cc5de8", "#ff8787", "#ffd43b"])}
        ${[[120, 70, "#ff8787"], [160, 55, "#ffd43b"], [200, 72, "#cc5de8"], [140, 95, "#ffa8a8"], [182, 96, "#f783ac"]].map(([x, y, c]) => `<g class="bloom"><circle cx="${x}" cy="${y}" r="16" fill="${c}"/><circle cx="${x}" cy="${y}" r="6" fill="#fff3bf"/></g>`).join("")}
        ${[136, 160, 184].map((x) => `<path d="M${x} 104L160 168" stroke="#2b8a3e" stroke-width="4"/>`).join("")}
        <path d="M128 120h64l-22 64h-20z" fill="#ffc9c9"/><path d="M146 150h28" stroke="#f06595" stroke-width="5" stroke-linecap="round"/>
      </svg>`,
      () => `<svg viewBox="0 0 320 200" class="art">
        <rect width="320" height="200" fill="#fff0f6"/>${confetti(22, ["#f06595", "#845ef7", "#fcc419", "#20c997"])}
        <rect x="118" y="98" width="84" height="72" rx="6" fill="#845ef7"/><rect x="154" y="98" width="12" height="72" fill="#fcc419"/>
        <rect x="112" y="86" width="96" height="18" rx="4" fill="#9775fa"/><path d="M160 86c-24-28-40-4-6 0 34-4 18-28-6 0" fill="none" stroke="#fcc419" stroke-width="6"/>
      </svg>`
    ],
    christmas: [
      () => `<svg viewBox="0 0 320 200" class="art">
        <rect width="320" height="200" fill="#0b3d2e"/>${snow(26)}
        <path d="M160 26l60 70h-26l40 46h-28l34 40H80l34-40H86l40-46h-26z" fill="#2b8a3e"/><rect x="150" y="182" width="20" height="14" fill="#7f4f24"/>
        <path class="star" d="M160 10l5 11 12 1-9 8 3 12-11-6-11 6 3-12-9-8 12-1z" fill="#ffd43b"/>
        ${[[140, 80, "#fa5252"], [180, 92, "#ffd43b"], [128, 128, "#74c0fc"], [196, 136, "#fa5252"], [160, 112, "#ffd43b"], [150, 160, "#e599f7"], [190, 166, "#74c0fc"]].map(([x, y, c], i) => `<circle class="light" cx="${x}" cy="${y}" r="5" fill="${c}" style="animation-delay:${i * 0.25}s"/>`).join("")}
      </svg>`,
      () => `<svg viewBox="0 0 320 200" class="art">
        <rect width="320" height="200" fill="#1c3a5e"/>${snow(30)}
        <path d="M0 170q80-26 160 0t160 0v30H0z" fill="#f1f3f5"/>
        ${fish(100, 120, 1, `<path d="M8-14l16-30 18 24z" fill="#e03131"/><circle cx="24" cy="-46" r="6" fill="#fff"/><path d="M8-14h34" stroke="#fff" stroke-width="5"/>`)}
        <path class="star" d="M262 30l5 11 12 1-9 8 3 12-11-6-11 6 3-12-9-8 12-1z" fill="#ffd43b"/>
      </svg>`
    ],
    newyear: [
      () => `<svg viewBox="0 0 320 200" class="art">
        <rect width="320" height="200" fill="#1a1b3a"/>
        ${[[80, 70, "#ffd43b"], [230, 60, "#ff6b6b"], [160, 40, "#74c0fc"], [270, 120, "#b197fc"]].map(([x, y, c], i) => `<g class="burst" style="animation-delay:${i * 0.5}s">${Array.from({ length: 12 }, (_, k) => { const a = (k / 12) * Math.PI * 2; return `<line x1="${x}" y1="${y}" x2="${x + Math.cos(a) * 26}" y2="${y + Math.sin(a) * 26}" stroke="${c}" stroke-width="3" stroke-linecap="round"/>`; }).join("")}</g>`).join("")}
        <text x="160" y="170" text-anchor="middle" font-size="34" font-weight="800" fill="#ffd43b">${new Date().getFullYear()}</text>
      </svg>`,
      () => `<svg viewBox="0 0 320 200" class="art">
        <rect width="320" height="200" fill="#212529"/>${confetti(26, ["#ffd43b", "#fff", "#ffa94d"])}
        <g transform="translate(120 60) rotate(-12)"><path d="M0 0h30l-4 60h-22z" fill="#fff3bf" opacity=".9"/><path d="M15 60v40M2 100h26" stroke="#dee2e6" stroke-width="4"/></g>
        <g transform="translate(176 60) rotate(12)"><path d="M0 0h30l-4 60h-22z" fill="#fff3bf" opacity=".9"/><path d="M15 60v40M2 100h26" stroke="#dee2e6" stroke-width="4"/></g>
        <text x="160" y="40" text-anchor="middle" font-size="22" fill="#ffd43b">✦ ✦ ✦</text>
      </svg>`
    ],
    easter: [
      () => `<svg viewBox="0 0 320 200" class="art">
        <rect width="320" height="200" fill="#ebfbee"/><path d="M0 160q160-40 320 0v40H0z" fill="#8ce99a"/>
        ${[[100, "#ffa8a8", "#fff"], [160, "#a5d8ff", "#ffd43b"], [220, "#ffec99", "#f783ac"]].map(([x, c, s], i) => `<g class="egg" style="animation-delay:${i * 0.3}s"><ellipse cx="${x}" cy="130" rx="24" ry="32" fill="${c}"/><path d="M${x - 22} 126q11-10 22 0t22 0" stroke="${s}" stroke-width="4" fill="none"/></g>`).join("")}
        ${[50, 270].map((x) => `<g class="bloom"><circle cx="${x}" cy="60" r="12" fill="#ffd43b"/><circle cx="${x}" cy="60" r="5" fill="#fd7e14"/></g>`).join("")}
      </svg>`,
      () => `<svg viewBox="0 0 320 200" class="art">
        <rect width="320" height="200" fill="#fff9db"/><path d="M0 165q160-30 320 0v35H0z" fill="#b2f2bb"/>
        <g class="egg"><ellipse cx="160" cy="118" rx="44" ry="56" fill="#d0bfff"/><path d="M118 110q21-14 42 0t42 0" stroke="#fff" stroke-width="6" fill="none"/><path d="M120 134q20 12 40 0t40 0" stroke="#ffd43b" stroke-width="6" fill="none"/></g>
        ${fish(30, 150, 0.6, "")}
      </svg>`
    ],
    halloween: [
      () => `<svg viewBox="0 0 320 200" class="art">
        <rect width="320" height="200" fill="#2b2140"/><circle cx="250" cy="50" r="28" fill="#fff3bf"/>
        <g class="pumpkin"><ellipse cx="160" cy="140" rx="56" ry="44" fill="#fd7e14"/><path d="M160 96v-16" stroke="#2b8a3e" stroke-width="6"/>
        <path d="M134 128l12-14 12 14zM162 128l12-14 12 14z" fill="#ffe066" class="glow"/><path d="M130 150q30 20 60 0l-8 6-8-6-8 6-8-6-8 6z" fill="#ffe066" class="glow"/></g>
        ${[[70, 60], [110, 40], [210, 90]].map(([x, y], i) => `<path class="bat" style="animation-delay:${i * 0.4}s" d="M${x} ${y}q8-10 16 0q8-10 16 0q-8 2-16 8q-8-6-16-8z" fill="#111"/>`).join("")}
      </svg>`,
      () => `<svg viewBox="0 0 320 200" class="art">
        <rect width="320" height="200" fill="#1b1b2f"/><circle cx="70" cy="50" r="24" fill="#fff9db"/>
        ${fish(110, 120, 1.05, `<path d="M6-12h48l-24-40z" fill="#5f3dc4"/><path d="M0-12h60" stroke="#5f3dc4" stroke-width="6"/>`)}
        ${[[230, 50], [260, 80]].map(([x, y], i) => `<path class="bat" style="animation-delay:${i * 0.5}s" d="M${x} ${y}q8-10 16 0q8-10 16 0q-8 2-16 8q-8-6-16-8z" fill="#000"/>`).join("")}
      </svg>`
    ],
    memory: [() => `<svg viewBox="0 0 320 120" class="art"><rect width="320" height="120" fill="#e3fafc"/>${fish(110, 66, 0.9, "")}<text x="270" y="40" font-size="30">📅</text></svg>`]
  };
  // Napi változat (mindenkinél ugyanaz aznap, de naponta / évente változik)
  function art(theme, seedKey) {
    const list = ART[theme] || ART.birthday;
    let h = 0; String(seedKey || "").split("").forEach((ch) => { h = (h * 31 + ch.charCodeAt(0)) >>> 0; });
    return list[h % list.length]();
  }

  // ------------------------------------------------------------------
  // Felugró ablak (naponta egyszer, felhasználónként)
  // ------------------------------------------------------------------
  function popupHtml(items, seed) {
    const main = items[0];
    return `<div class="cel-card" role="dialog" aria-modal="true" aria-labelledby="celTitle">
      <div class="cel-art">${art(main.theme, seed + main.theme)}</div>
      <div class="cel-body">
        ${items.map((it, i) => `<div class="cel-item${i ? " small" : ""}"><div class="cel-title"${i ? "" : ' id="celTitle"'}>${esc(it.title)}</div><div class="cel-text">${esc(it.text)}</div></div>`).join("")}
        <button type="button" class="btn primary block" data-cel-close>${main.own ? "Köszönöm! 🎣" : "Bezárás"}</button>
      </div></div>`;
  }
  function openPopup(items, seed) {
    if (!items.length) return;
    let ov = $("#celOverlay");
    if (!ov) { ov = document.createElement("div"); ov.id = "celOverlay"; ov.className = "cel-overlay"; document.body.appendChild(ov); }
    ov.innerHTML = popupHtml(items, seed);
    ov.classList.remove("hidden");
    const b = ov.querySelector("[data-cel-close]"); if (b) b.focus();
  }
  function closePopup() { const ov = $("#celOverlay"); if (ov) { ov.classList.add("hidden"); ov.innerHTML = ""; } }

  function maybePopup() {
    if (!state.uid || !C) return;
    const date = C.bpDate(new Date());
    const key = `celebrated:${state.uid}:${date.key}`;
    if (ls.get(key)) return;
    const r = C.dayItems(state.uid, ctxNow(date));
    if (!r.items.length) return;
    ls.set(key, "1");
    openPopup(r.items, date.key);
  }

  // ------------------------------------------------------------------
  // Kezdőlap: ünnepi sáv, „Ma volt…”, születésnap kérése
  // ------------------------------------------------------------------
  function homeHtml() {
    if (!C || !state.uid) return "";
    const date = C.bpDate(new Date());
    const r = C.dayItems(state.uid, ctxNow(date));
    let h = "";
    if (r.items.length) {
      h += `<button type="button" class="card cel-strip" data-cel-show>${r.items.map((i) => `<span>${esc(i.title)}</span>`).join("")}</button>`;
    }
    if (r.memories.length) {
      h += `<div class="card mem-card"><h3>📅 Ma volt…</h3>${r.memories.map((m) => {
        const when = `<span class="mem-when">${esc(C.yearsText(m.years))}</span>`;
        if (m.kind === "trip") {
          return `<button type="button" class="mem-row" data-mem-trip="${esc(m.trip.id)}">${when}<span class="mem-what">🧭 ${esc(m.trip.title)}${m.catchCount ? ` <small class="hint">· ${m.catchCount} fogás aznap</small>` : ""}</span></button>`;
        }
        const c = m.catch;
        return `<button type="button" class="mem-row" data-mem-catch="${esc(c.client_id)}">${when}<span class="mem-what">🐟 ${esc(C.memoryLine(m, A.nameOf))}${m.more ? ` <small class="hint">és még ${m.more} fogás</small>` : ""}</span></button>`;
      }).join("")}</div>`;
    }
    // A meglévő tagok dátumait az admin tölti fel (meglepetés) – a kezdőlap nem kéri (8.1)
    return h;
  }

  // ------------------------------------------------------------------
  // Születésnap / névnap megadása
  // ------------------------------------------------------------------
  const mdSelect = (id, m, d, req) => `<div class="md-row">
      <select id="${id}M" aria-label="Hónap"${req ? " required" : ""}><option value="">hónap</option>${MONTHS.map((n, i) => `<option value="${i + 1}"${m === i + 1 ? " selected" : ""}>${n}</option>`).join("")}</select>
      <select id="${id}D" aria-label="Nap"${req ? " required" : ""}><option value="">nap</option>${Array.from({ length: 31 }, (_, i) => `<option value="${i + 1}"${d === i + 1 ? " selected" : ""}>${i + 1}.</option>`).join("")}</select></div>`;
  const mdText = (m, d) => (m && d ? `${MONTHS[m - 1]} ${d}.` : "nincs megadva");
  const validMd = (m, d) => m >= 1 && m <= 12 && d >= 1 && d <= [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];

  function openEdit(id) {
    const p = (state.profiles || {})[id] || (state.me && state.me.id === id ? state.me : null);
    if (!p) return;
    if (id !== state.uid && !isAdmin()) return;
    let ov = $("#celOverlay");
    if (!ov) { ov = document.createElement("div"); ov.id = "celOverlay"; ov.className = "cel-overlay"; document.body.appendChild(ov); }
    ov.innerHTML = `<div class="cel-card cel-form" role="dialog" aria-modal="true" aria-labelledby="celEditTitle">
      <div class="cel-body">
        <h2 id="celEditTitle">🎂 ${id === state.uid ? "Születésnapom, névnapom" : esc(p.display_name)}</h2>
        <p class="hint">Év nélkül. Ezeken a napokon az app felköszönt, és a csapat értesítést kap. Módosítható, de nem törölhető.</p>
        <label class="field">Születésnap ${mdSelect("celB", p.birth_month, p.birth_day, true)}</label>
        <label class="field">Névnap ${mdSelect("celN", p.nameday_month, p.nameday_day, false)}</label>
        <p class="msg" id="celMsg" role="status"></p>
        <button type="button" class="btn primary block" data-cel-save="${esc(id)}">Mentés</button>
        <button type="button" class="btn block" data-cel-close>Mégse</button>
      </div></div>`;
    ov.classList.remove("hidden");
  }
  async function saveEdit(id) {
    const v = (x) => Number($(x).value) || null;
    const bm = v("#celBM"), bd = v("#celBD"), nm = v("#celNM"), nd = v("#celND");
    const msg = $("#celMsg");
    const p = (state.profiles || {})[id] || state.me;
    try {
      if (!bm || !bd) throw new Error("Add meg a születésnapot (hónap és nap).");
      if (!validMd(bm, bd)) throw new Error("Érvénytelen születésnap.");
      if (!nm && p && p.nameday_month) throw new Error("A névnap nem törölhető, csak módosítható.");
      if ((nm && !nd) || (!nm && nd)) throw new Error("A névnaphoz a hónap és a nap is kell.");
      if (nm && !validMd(nm, nd)) throw new Error("Érvénytelen névnap.");
      const { error } = await state.sb.rpc("set_celebrations", { member: id, b_month: bm, b_day: bd, n_month: nm, n_day: nd });
      if (error) throw error;
      const upd = { birth_month: bm, birth_day: bd, nameday_month: nm || (p && p.nameday_month) || null, nameday_day: nd || (p && p.nameday_day) || null };
      if (state.profiles && state.profiles[id]) Object.assign(state.profiles[id], upd);
      if (state.me && state.me.id === id) Object.assign(state.me, upd);
      closePopup();
      toast("Mentve. 🎂");
      if (A.afterSave) A.afterSave(id);
    } catch (e) { msg.className = "msg err"; msg.textContent = errText(e); }
  }
  // Tagok listájában (admin): rövid kijelzés + szerkesztés gomb
  function memberHtml(p) {
    if (p.role === "viewer") return "";
    return `<small class="cel-member">🎂 ${esc(mdText(p.birth_month, p.birth_day))} · 🌷 ${esc(mdText(p.nameday_month, p.nameday_day))}
      <button type="button" class="link" data-cel-edit="${esc(p.id)}">módosítás</button></small>`;
  }

  // ------------------------------------------------------------------
  // Admin előnézet
  // ------------------------------------------------------------------
  function previewHtml() {
    const date = C.bpDate(new Date());
    const msg = C.composePush(state.uid, ctxNow(date));
    return `<div class="cel-prev">
      <p class="hint">Kipróbálhatod, hogyan néz ki a felugró ablak. A valódi ablak az adott napon, az app első megnyitásakor jelenik meg, naponta egyszer.</p>
      <div class="chips">
        ${[["birthday-own", "🎂 Születésnap (saját)"], ["birthday", "🎂 Születésnap (másé)"], ["nameday", "🌷 Névnap"], ["christmas", "🎄 Karácsony"], ["newyear", "🥂 Újév"], ["easter", "🐣 Húsvét"], ["halloween", "🎃 Halloween"]]
          .map(([k, l]) => `<button type="button" class="chip" data-cel-prev="${k}">${l}</button>`).join("")}
      </div>
      <h4>A mai reggel 8-as értesítés szövege</h4>
      ${msg ? `<div class="push-prev"><b>${esc(msg.title)}</b><br>${esc(msg.body).replace(/\n/g, "<br>")}</div>` : `<p class="hint">Ma nincs ünnep, születésnap, névnap vagy emlék – nem megy értesítés.</p>`}
      <button type="button" class="btn small" data-cel-pushtest>Mai értesítés küldése magamnak (próba)</button>
    </div>`;
  }
  function preview(kind) {
    const me = state.me || {}, other = Object.values(state.profiles || {}).find((p) => p.id !== state.uid && p.role !== "viewer") || { display_name: "Nagy Béla" };
    const fn = (n) => C.firstName(n);
    const H = { christmas: [12, 24], newyear: [1, 1], halloween: [10, 31] };
    let items;
    if (kind === "birthday-own") items = [{ theme: "birthday", own: true, title: `🎂 Boldog születésnapot, ${fn(me.display_name)}!`, text: "Sok szép fogást és nagy halakat kíván a TFT csapata!" }];
    else if (kind === "birthday") items = [{ theme: "birthday", own: false, title: `🎂 Ma VAN ${fn(other.display_name)} születésnapja!`, text: "Köszöntsd fel!" }];
    else if (kind === "nameday") items = [{ theme: "nameday", own: false, title: `🌷 Ma VAN ${fn(other.display_name)} névnapja!`, text: "Köszöntsd fel!" }];
    else {
      const y = new Date().getFullYear(), e = C.easter(y), md = kind === "easter" ? [e.m, e.d] : H[kind];
      const h = C.holidayOf(y, md[0], md[1]);
      items = [{ theme: h.key, own: false, title: `${h.emoji} ${h.title}`, text: h.text }];
    }
    openPopup(items, String(Date.now()));
  }
  async function pushTest() {
    try {
      const r = await A.callFn("daily_preview", {});
      if (r && r.none) toast("Ma nincs mit küldeni (nincs ünnep, születésnap, névnap vagy emlék).", 4000);
      else if (r && r.sent && r.sent.ok) toast("Elküldve – nézd meg az értesítéseidet.", 4000);
      else toast("Ezen a készüléken nincs bekapcsolva az értesítés.", 4000);
    } catch (e) { toast(errText(e), 5000); }
  }

  document.addEventListener("click", (e) => {
    const g = (s) => e.target.closest(s);
    let el;
    if (g("[data-cel-close]")) { closePopup(); return; }
    if (e.target.id === "celOverlay") { closePopup(); return; }
    if (g("[data-cel-show]")) { const d = C.bpDate(new Date()); openPopup(C.dayItems(state.uid, ctxNow(d)).items, d.key); return; }
    if ((el = g("[data-cel-edit]"))) { openEdit(el.dataset.celEdit); return; }
    if ((el = g("[data-cel-save]"))) { saveEdit(el.dataset.celSave); return; }
    if ((el = g("[data-cel-prev]"))) { preview(el.dataset.celPrev); return; }
    if (g("[data-cel-pushtest]")) { pushTest(); return; }
    if ((el = g("[data-mem-trip]"))) { A.openTrip(el.dataset.memTrip); return; }
    if ((el = g("[data-mem-catch]"))) { A.openCatch(el.dataset.memCatch); return; }
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && $("#celOverlay") && !$("#celOverlay").classList.contains("hidden")) closePopup(); });

  return { maybePopup, homeHtml, openEdit, memberHtml, previewHtml, preview, mdSelect, validMd, MONTHS, _art: (t, i) => (ART[t] || [])[i] ? ART[t][i]() : "" };
};
