/* =====================================================================
   Horgásznapló – Napi idézet (7.4 verzió)
   A csapat szállóigéi közül naponta egy jelenik meg a kezdőlapon, mindenkinél
   ugyanaz (budapesti idő szerint éjfélkor vált). A teljes lista titkos: csak az
   admin látja és szerkeszti; a többiek a szervertől csak az aznapi idézetet kapják.
   Az app.js hívja meg: window.TFTQuotes(api)
   ===================================================================== */
window.TFTQuotes = function (A) {
  "use strict";
  const { state, $, esc, toast, errText, idb, tzParts } = A;

  const Q = { today: null, day: null, list: [], editId: null, loading: false, shown: new Map(), cycleStart: null, nextStart: null };
  const isAdmin = () => !!(state.me && state.me.is_admin && state.me.role !== "viewer");
  const dayKey = () => { const p = tzParts(new Date()); return `${p.y}-${p.m}-${p.d}`; };

  async function loadCache() {
    const c = await idb.get("kv", "quote").catch(() => null);
    if (c && c.uid === state.uid && c.day === dayKey()) { Q.today = c.text; Q.day = c.day; }
  }

  // Az aznapi idézet lekérése (naponta egyszer; offline a tárolt marad)
  async function loadDaily(force) {
    const day = dayKey();
    if (!force && Q.day === day) return;
    if (!navigator.onLine || !state.sb || Q.loading) return;
    Q.loading = true;
    try {
      const { data, error } = await state.sb.rpc("quote_of_day");
      if (error) throw error;
      Q.today = data || null;
      Q.day = day;
      await idb.put("kv", { uid: state.uid, day, text: Q.today }, "quote").catch(() => {});
    } catch (e) {
      // A 7.4-es SQL még nem futott le: idézet nélkül működik tovább
      Q.today = null;
      Q.day = day;
    } finally {
      Q.loading = false;
    }
  }

  // A kezdőlapon a köszöntés alatt
  function homeHtml() {
    if (Q.day && Q.day !== dayKey()) { loadDaily().then(() => { if (state.tab === "tabHome") A.renderHome(); }); }
    return Q.today ? `<div class="home-quote" aria-label="A nap idézete">„${esc(Q.today)}”</div>` : "";
  }

  // ------------------------------------------------------------------
  // Szerkesztés (csak admin)
  // ------------------------------------------------------------------
  async function open() {
    if (!isAdmin()) return;
    A.show("viewQuotes");
    Q.editId = null;
    await loadList();
  }

  async function loadList() {
    const box = $("#quoteList");
    if (!box) return;
    box.innerHTML = `<p class="hint">Betöltés…</p>`;
    try {
      const { data, error } = await state.sb.from("quotes").select("*").order("created_at");
      if (error) throw error;
      Q.list = (data || []).slice().sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
      await loadCycle();
      renderList();
    } catch (e) {
      box.innerHTML = `<p class="msg err">${esc(errText(e))}</p>`;
    }
  }

  // Ciklus (kör): mely idézetek szerepeltek már a kör kezdete óta (8.0)
  async function loadCycle() {
    Q.shown = new Map(); Q.cycleStart = null; Q.nextStart = null;
    try {
      const st = await state.sb.from("app_settings").select("value").eq("key", "quote_cycle_start").maybeSingle();
      if (st.error) throw st.error;
      const start = st.data ? String(st.data.value) : null;
      const today = dayKey();
      if (start && start > today) { Q.nextStart = start; }
      const { data, error } = await state.sb.from("quote_days").select("day, quote_id").order("day", { ascending: false });
      if (error) throw error;
      // A kör kezdete: ha holnaptól új kör indul, a mai az utolsó nap a régi körből
      const from = start && start <= today ? start : null;
      Q.cycleStart = from;
      (data || []).forEach((r) => { if (r.quote_id && (!from || r.day >= from) && !Q.shown.has(r.quote_id)) Q.shown.set(r.quote_id, r.day); });
      if (Q.nextStart) { Q.shown = new Map(); (data || []).filter((r) => r.day === today && r.quote_id).forEach((r) => Q.shown.set(r.quote_id, r.day)); }
      Q.cycleOk = true;
    } catch (e) {
      Q.cycleOk = false;   // a 8.0-s adatbázis-frissítés még nem futott le
    }
  }
  const md = (iso) => { const [, m, d] = String(iso).split("-"); return `${m}.${d}.`; };

  async function restartCycle() {
    if (!confirm("Új kört indítasz? A mai idézet marad, holnaptól minden idézet újra sorra kerül, új véletlen sorrendben.")) return;
    try {
      const { error } = await state.sb.rpc("restart_quote_cycle");
      if (error) throw error;
      toast("Új kör indul holnaptól.");
      await loadList();
    } catch (e) { toast(errText(e), 5000); }
  }

  function renderList() {
    const box = $("#quoteList");
    if (!box) return;
    $("#quoteCount").textContent = `${Q.list.length} idézet`;
    const cyc = $("#quoteCycle");
    if (cyc) {
      cyc.innerHTML = !Q.cycleOk ? `<p class="hint">A körök követéséhez a 8.0-s adatbázis-frissítés szükséges.</p>`
        : `<div class="q-cycle"><span>${Q.nextStart ? `Új kör indul: <b>${esc(md(Q.nextStart))}</b>` : `Kör: <b>${Q.cycleStart ? esc(md(Q.cycleStart)) : "–"}</b> óta · <b>${Q.list.filter((q) => Q.shown.has(q.id)).length}</b> / ${Q.list.length} szerepelt`}</span>
          <button type="button" class="btn small" id="btnQuoteRestart">🔄 Új kör indítása</button></div>`;
    }
    box.innerHTML = Q.list.length ? Q.list.map((q) => {
      const isToday = Q.today && q.body === Q.today;
      if (Q.editId === q.id) {
        return `<div class="quote-row editing">
          <textarea class="quote-edit" rows="2" maxlength="300">${esc(q.body)}</textarea>
          <div class="row-btns"><button type="button" class="btn small primary" data-q-save="${esc(q.id)}">Mentés</button>
            <button type="button" class="btn small" data-q-cancel>Mégse</button></div></div>`;
      }
      return `<div class="quote-row${isToday ? " today" : ""}">
        <div class="quote-text">„${esc(q.body)}”${isToday ? ` <span class="tag">ma ez látszik</span>` : ""}</div>
        ${Q.cycleOk ? `<small class="q-state ${Q.shown.has(q.id) ? "done" : ""}">${Q.shown.has(q.id) ? `✓ ebben a körben szerepelt: ${esc(md(Q.shown.get(q.id)))}` : "○ ebben a körben még nem szerepelt"}</small>` : ""}
        <div class="catch-actions"><button type="button" class="link" data-q-edit="${esc(q.id)}">Szerkesztés</button>
          <button type="button" class="link btn-danger-link" data-q-del="${esc(q.id)}">Törlés</button></div></div>`;
    }).join("") : `<p class="hint">Még nincs idézet. Az elsőt fent veheted fel.</p>`;
  }

  async function add() {
    const ta = $("#quoteNew");
    const body = ta.value.trim();
    if (!body) { toast("Írd be az idézetet."); return; }
    if (Q.list.some((q) => q.body.trim().toLowerCase() === body.toLowerCase())) { toast("Ez az idézet már szerepel a listában."); return; }
    try {
      const { error } = await state.sb.from("quotes").insert({ body });
      if (error) throw error;
      ta.value = "";
      toast("Idézet felvéve.");
      await loadList();
    } catch (e) { toast(errText(e), 5000); }
  }

  async function save(id) {
    const ta = document.querySelector(".quote-edit");
    const body = ta ? ta.value.trim() : "";
    if (!body) { toast("Az idézet nem lehet üres."); return; }
    try {
      const { data, error } = await state.sb.from("quotes").update({ body }).eq("id", id).select("id");
      if (error) throw error;
      if (!data || !data.length) throw new Error("Nincs jogosultságod a módosításhoz.");
      Q.editId = null;
      toast("Idézet javítva.");
      await loadList();
      await loadDaily(true);
    } catch (e) { toast(errText(e), 5000); }
  }

  async function del(id) {
    const q = Q.list.find((x) => x.id === id);
    if (!q || !confirm(`Törlöd ezt az idézetet?\n\n„${q.body}”`)) return;
    try {
      const { data, error } = await state.sb.from("quotes").delete().eq("id", id).select("id");
      if (error) throw error;
      if (!data || !data.length) throw new Error("Nincs jogosultságod a törléshez.");
      toast("Idézet törölve.");
      await loadList();
      await loadDaily(true);
    } catch (e) { toast(errText(e), 5000); }
  }

  document.addEventListener("click", (e) => {
    const g = (sel) => e.target.closest(sel);
    let el;
    if (g("#btnQuoteAdd")) { add(); return; }
    if (g("#btnQuoteRestart")) { restartCycle(); return; }
    if (g("#btnQuotesBack")) { A.show("viewMain"); if (state.tab === "tabHome") A.renderHome(); return; }
    if ((el = g("[data-q-edit]"))) { Q.editId = el.dataset.qEdit; renderList(); const t = document.querySelector(".quote-edit"); if (t) t.focus(); return; }
    if (g("[data-q-cancel]")) { Q.editId = null; renderList(); return; }
    if ((el = g("[data-q-save]"))) { save(el.dataset.qSave); return; }
    if ((el = g("[data-q-del]"))) { del(el.dataset.qDel); return; }
  });

  function reset() { Q.today = null; Q.day = null; Q.list = []; Q.editId = null; }

  return { loadCache, loadDaily, homeHtml, open, reset, isAdmin };
};
