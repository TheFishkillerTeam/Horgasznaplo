/* =====================================================================
   Horgásznapló – Rekordlisták (Napló → „Rekordok” nézet)
   Rangsor súly szerint (fajonként vagy együtt) és horgászonként darabszám
   szerint; keresztszűrés halfajra, vízterületre, horgászra, évre,
   hónapra / évszakra és túrára (szűrőn belül VAGY, szűrők között ÉS).
   Az app.js hívja meg: window.TFTRecords(api)
   ===================================================================== */
window.TFTRecords = function (A) {
  "use strict";
  const { $, esc, numFmt, dtFmt, tzParts } = A;

  const KEYS = ["species", "water", "user", "year", "month", "trip"];
  const LABEL = { species: "Halfaj", water: "Vízterület", user: "Horgász", year: "Év", month: "Hónap", trip: "Túra" };
  const MONTHS = ["január", "február", "március", "április", "május", "június", "július", "augusztus", "szeptember", "október", "november", "december"];
  const SEASONS = [["Tavasz", [3, 4, 5]], ["Nyár", [6, 7, 8]], ["Ősz", [9, 10, 11]], ["Tél", [12, 1, 2]]];
  const TOP = 10;

  const R = { f: {}, mode: "weight", bySpecies: true, showAll: {}, open: new Set(), pick: null };
  KEYS.forEach((k) => { R.f[k] = []; });
  try {
    const s = JSON.parse(localStorage.getItem("recState") || "null");
    if (s) {
      KEYS.forEach((k) => { if (Array.isArray(s.f && s.f[k])) R.f[k] = s.f[k]; });
      if (s.mode === "count" || s.mode === "weight") R.mode = s.mode;
      if (typeof s.bySpecies === "boolean") R.bySpecies = s.bySpecies;
    }
  } catch (_) { /* nincs tároló */ }
  const save = () => { try { localStorage.setItem("recState", JSON.stringify({ f: R.f, mode: R.mode, bySpecies: R.bySpecies })); } catch (_) { /* nincs tároló */ } };

  // Egy fogás értéke az adott szűrő szerint (a hónap 1–12, a túra több is lehet)
  function valuesOf(c, key) {
    if (key === "species") return [c.species];
    if (key === "water") return [c.water];
    if (key === "user") return [c.user_id];
    if (key === "year") return [tzParts(new Date(c.caught_at)).y];
    if (key === "month") return [String(Number(tzParts(new Date(c.caught_at)).m))];
    if (key === "trip") return A.trips ? A.trips.tripsOfCatch(c).map((t) => t.id) : [];
    return [];
  }
  const passes = (c, key) => !R.f[key].length || valuesOf(c, key).some((v) => R.f[key].includes(v));
  const filtered = (except) => A.allEntries().filter((c) => KEYS.every((k) => k === except || passes(c, k)));

  function labelOf(key, v) {
    if (key === "user") return A.nameOf(v);
    if (key === "month") return MONTHS[Number(v) - 1];
    if (key === "trip") { const t = A.trips && A.trips.tripById(v); return t ? t.title : "(törölt túra)"; }
    return v;
  }
  function filterText(key) {
    const sel = R.f[key];
    if (!sel.length) return "mind";
    if (key === "month") {
      const season = SEASONS.find(([, ms]) => ms.length === sel.length && ms.every((m) => sel.includes(String(m))));
      if (season) return season[0].toLowerCase();
    }
    const first = labelOf(key, sel[0]);
    return sel.length === 1 ? first : `${first} +${sel.length - 1}`;
  }

  // Versenyszerű helyezés: azonos értéknél azonos helyezés (1., 2., 2., 4.)
  function ranked(list, valueOf) {
    let prev = null, rank = 0;
    return list.map((x, i) => {
      const v = valueOf(x);
      if (prev === null || v !== prev) rank = i + 1;
      prev = v;
      return { x, rank };
    });
  }
  const medal = (r) => (r === 1 ? "🥇" : r === 2 ? "🥈" : r === 3 ? "🥉" : `${r}.`);
  const kg = (v) => `${numFmt(v)} kg`;
  const dateText = (iso) => { const p = tzParts(new Date(iso)); return `${p.y}.${p.m}.${p.d}.`; };

  function render() {
    const out = $("#recOut");
    if (!out) return;
    const list = filtered();
    const anyFilter = KEYS.some((k) => R.f[k].length);
    $("#logCount").textContent = `${list.length} fogás`;
    let body = "";
    if (R.mode === "weight") {
      const w = list.filter((c) => c.weight_kg != null).sort((a, b) => Number(b.weight_kg) - Number(a.weight_kg) || (a.caught_at < b.caught_at ? -1 : 1));
      const noW = list.length - w.length;
      if (!w.length) body = `<div class="card empty">Nincs súllyal rögzített fogás ezekkel a szűrőkkel.</div>`;
      else if (R.bySpecies) {
        const groups = new Map();
        w.forEach((c) => { if (!groups.has(c.species)) groups.set(c.species, []); groups.get(c.species).push(c); });
        body = Array.from(groups.entries())
          .sort((a, b) => Number(b[1][0].weight_kg) - Number(a[1][0].weight_kg))
          .map(([sp, arr]) => listCard(sp, `${sp}`, arr, false)).join("");
      } else body = listCard("_all", "Minden halfaj együtt", w, true);
      if (noW) body += `<p class="hint rec-note">${noW} fogás súly nélkül van rögzítve, ezek nem szerepelnek a súly szerinti rangsorban.</p>`;
    } else {
      const m = new Map();
      list.forEach((c) => {
        const e = m.get(c.user_id) || { uid: c.user_id, n: 0, sum: 0, best: null };
        e.n++;
        if (c.weight_kg != null) { e.sum += Number(c.weight_kg); if (!e.best || Number(c.weight_kg) > Number(e.best.weight_kg)) e.best = c; }
        m.set(c.user_id, e);
      });
      const rows = Array.from(m.values()).sort((a, b) => b.n - a.n || b.sum - a.sum || A.nameOf(a.uid).localeCompare(A.nameOf(b.uid), "hu"));
      body = rows.length ? `<div class="card rec-list">
          <div class="rec-head"><strong>Horgászok darabszám szerint</strong><span class="hint">${rows.length} horgász</span></div>
          ${ranked(rows, (r) => r.n).map(({ x, rank }) => `
            <div class="rrow static">
              <span class="rrank r${Math.min(rank, 4)}">${medal(rank)}</span>
              <span class="rmain"><span class="rtitle">${esc(A.nameOf(x.uid))}</span>
                <span class="rsub">${x.sum ? `össz. ${esc(kg(Math.round(x.sum * 100) / 100))}` : "súly nélkül"}${x.best ? ` · legnagyobb: ${esc(x.best.species)} ${esc(kg(x.best.weight_kg))}` : ""}</span></span>
              <span class="rval"><b>${x.n}</b><small>db</small></span>
            </div>`).join("")}
        </div>` : `<div class="card empty">Nincs fogás ezekkel a szűrőkkel.</div>`;
    }
    out.innerHTML = `
      <div class="card rec-panel">
        <div class="rec-filters">
          ${KEYS.map((k) => `<button type="button" class="fbtn${R.f[k].length ? " on" : ""}" data-rf="${k}" aria-haspopup="dialog">
            <small>${LABEL[k]}</small><span>${esc(filterText(k))}</span></button>`).join("")}
        </div>
        <div class="rec-opts">
          <div class="seg2" role="group" aria-label="Rangsor típusa">
            <button type="button" data-rmode="weight" class="${R.mode === "weight" ? "active" : ""}" aria-pressed="${R.mode === "weight"}">Legnagyobb halak</button>
            <button type="button" data-rmode="count" class="${R.mode === "count" ? "active" : ""}" aria-pressed="${R.mode === "count"}">Horgászok (db)</button>
          </div>
          ${anyFilter ? `<button type="button" class="link" data-rclear>Szűrők törlése</button>` : ""}
        </div>
        ${R.mode === "weight" ? `<label class="check small-check"><input type="checkbox" data-rbysp ${R.bySpecies ? "checked" : ""}> Fajonként külön rangsor</label>` : ""}
        <p class="hint">Egy szűrőn belül több érték is választható (bármelyik), a szűrők együtt érvényesek. A vendégfogások (versenyen kívül) nem szerepelnek.</p>
      </div>
      ${body}`;
    R.open.forEach((id) => openRow(id, true));
  }

  function listCard(key, title, arr, showSpecies) {
    const all = !!R.showAll[key];
    const rows = ranked(arr, (c) => Number(c.weight_kg));
    const shown = all ? rows : rows.slice(0, TOP);
    return `<div class="card rec-list">
      <div class="rec-head"><strong>${esc(title)}</strong><span class="hint">${arr.length} db</span></div>
      ${shown.map(({ x: c, rank }) => `
        <div class="rwrap" data-rid="${esc(c.client_id)}">
          <button type="button" class="rrow" data-rrow="${esc(c.client_id)}" aria-expanded="false">
            <span class="rrank r${Math.min(rank, 4)}">${medal(rank)}</span>
            <span class="rmain"><span class="rtitle">${showSpecies ? esc(c.species) + " · " : ""}${esc(A.nameOf(c.user_id))}</span>
              <span class="rsub">${esc(c.water)} · ${esc(dateText(c.caught_at))}</span></span>
            <span class="rval"><b>${esc(numFmt(c.weight_kg))}</b><small>kg${c.length_cm != null ? ` · ${esc(numFmt(c.length_cm, 1))} cm` : ""}</small></span>
          </button>
          <div class="rdetail hidden"></div>
        </div>`).join("")}
      ${rows.length > TOP ? `<button type="button" class="link rmore" data-rmore="${esc(key)}">${all ? "Csak az első 10" : `Mind a ${rows.length} mutatása`}</button>` : ""}
    </div>`;
  }

  function openRow(id, force) {
    const wrap = $(`#recOut .rwrap[data-rid="${CSS.escape(id)}"]`);
    if (!wrap) return;
    const det = wrap.querySelector(".rdetail"), btn = wrap.querySelector(".rrow");
    const open = force || det.classList.contains("hidden");
    if (open) {
      const c = A.allEntries().find((x) => x.client_id === id);
      if (!c) return;
      det.innerHTML = A.cardHtml(c, { inner: true });
      A.loadThumbs(det, [c]);
      R.open.add(id);
    } else R.open.delete(id);
    det.classList.toggle("hidden", !open);
    btn.setAttribute("aria-expanded", open ? "true" : "false");
    wrap.classList.toggle("open", open);
  }

  // ---- Többes választó (alsó lap) ----
  function openPick(key) {
    const base = filtered(key);
    const counts = new Map();
    base.forEach((c) => valuesOf(c, key).forEach((v) => counts.set(v, (counts.get(v) || 0) + 1)));
    let opts;
    if (key === "month") opts = MONTHS.map((_, i) => String(i + 1));
    else if (key === "year") opts = Array.from(new Set(A.allEntries().map((c) => valuesOf(c, "year")[0]))).sort().reverse();
    else if (key === "trip") opts = (A.trips ? A.trips.all() : []).slice().sort((a, b) => (a.start_at < b.start_at ? 1 : -1)).map((t) => t.id);
    else opts = Array.from(new Set(A.allEntries().flatMap((c) => valuesOf(c, key)))).sort((a, b) => labelOf(key, a).localeCompare(labelOf(key, b), "hu"));
    R.pick = { key, sel: new Set(R.f[key]) };
    $("#pickTitle").textContent = LABEL[key];
    $("#pickQuick").innerHTML = key === "month"
      ? SEASONS.map(([n, ms]) => `<button type="button" class="chip" data-season="${ms.join(",")}">${n}</button>`).join("") : "";
    $("#pickQuick").classList.toggle("hidden", key !== "month");
    $("#pickList").innerHTML = opts.length ? opts.map((v) => `
      <label class="pcheck${counts.get(v) ? "" : " zero"}"><input type="checkbox" value="${esc(v)}" ${R.pick.sel.has(v) ? "checked" : ""}>
        <span>${esc(labelOf(key, v))}</span><small>${counts.get(v) || 0}</small></label>`).join("")
      : `<p class="hint">${key === "trip" ? "Még nincs túra." : "Nincs választható érték."}</p>`;
    $("#pickSheet").classList.remove("hidden");
  }
  function closePick(apply) {
    if (apply && R.pick) {
      R.f[R.pick.key] = Array.from($("#pickList").querySelectorAll("input:checked")).map((i) => i.value);
      R.showAll = {};
      save();
      render();
    }
    R.pick = null;
    $("#pickSheet").classList.add("hidden");
  }

  function onClick(e) {
    const g = (s) => e.target.closest(s);
    let el;
    if (g("#pickSheet")) {
      if (e.target.id === "pickSheet") return closePick(true);
      if (g("#btnPickOk")) return closePick(true);
      if (g("#btnPickNone")) { $("#pickList").querySelectorAll("input").forEach((i) => { i.checked = false; }); return; }
      if ((el = g("[data-season]"))) {
        const ms = el.dataset.season.split(",");
        const inputs = Array.from($("#pickList").querySelectorAll("input"));
        const allOn = ms.every((m) => inputs.find((i) => i.value === m).checked);
        inputs.forEach((i) => { if (ms.includes(i.value)) i.checked = !allOn; });
      }
      return;
    }
    if (!g("#recOut")) return;
    if ((el = g("[data-rf]"))) return openPick(el.dataset.rf);
    if ((el = g("[data-rmode]"))) { R.mode = el.dataset.rmode; save(); render(); return; }
    if (g("[data-rclear]")) { KEYS.forEach((k) => { R.f[k] = []; }); R.showAll = {}; save(); render(); return; }
    if ((el = g("[data-rmore]"))) { R.showAll[el.dataset.rmore] = !R.showAll[el.dataset.rmore]; render(); return; }
    if ((el = g("[data-rrow]"))) return openRow(el.dataset.rrow, false);
  }
  document.addEventListener("click", onClick);
  document.addEventListener("change", (e) => {
    if (e.target.matches("[data-rbysp]")) { R.bySpecies = e.target.checked; R.showAll = {}; save(); render(); }
  });

  return { render, _: { R, ranked, filtered } };
};
