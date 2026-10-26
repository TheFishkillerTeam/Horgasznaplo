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

  const Q = { today: null, day: null, list: [], editId: null, loading: false };
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
      renderList();
    } catch (e) {
      box.innerHTML = `<p class="msg err">${esc(errText(e))}</p>`;
    }
  }

  function renderList() {
    const box = $("#quoteList");
    if (!box) return;
    $("#quoteCount").textContent = `${Q.list.length} idézet`;
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
    if (g("#btnQuotesBack")) { A.show("viewMain"); if (state.tab === "tabHome") A.renderHome(); return; }
    if ((el = g("[data-q-edit]"))) { Q.editId = el.dataset.qEdit; renderList(); const t = document.querySelector(".quote-edit"); if (t) t.focus(); return; }
    if (g("[data-q-cancel]")) { Q.editId = null; renderList(); return; }
    if ((el = g("[data-q-save]"))) { save(el.dataset.qSave); return; }
    if ((el = g("[data-q-del]"))) { del(el.dataset.qDel); return; }
  });

  function reset() { Q.today = null; Q.day = null; Q.list = []; Q.editId = null; }

  return { loadCache, loadDaily, homeHtml, open, reset, isAdmin };
};
