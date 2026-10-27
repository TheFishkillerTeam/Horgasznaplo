/* =====================================================================
   Horgásznapló – Karbantartás (7.5 verzió, csak admin)
   - Teljes mentés: minden adat egy JSON-fájlba (a Supabase ingyenes csomagja
     nem készít automatikus mentést). A fotók a fotótárban maradnak, a mentés
     az útvonalukat tartalmazza.
   - Tárhelyfigyelés: fotótár és adatbázis mérete az ingyenes korláthoz képest,
     80% felett figyelmeztetés a kezdőlapon.
   Az app.js hívja meg: window.TFTAdmin(api)
   ===================================================================== */
window.TFTAdmin = function (A) {
  "use strict";
  const { state, $, esc, toast, errText, idb, tzParts, dtFmt } = A;

  // Az ingyenes csomag korlátai (2026.10.; a Supabase módosíthatja őket)
  const LIMIT = { photos: 1024 * 1024 * 1024, db: 500 * 1024 * 1024 };
  const WARN = 0.8;
  const TABLES = ["profiles", "catches", "trips", "trip_people", "trip_photos", "trip_posts", "trip_catch_links", "invites", "quotes"];
  const S = { usage: null, checkedDay: null, busy: false };
  const isAdmin = () => !!(state.me && state.me.is_admin && state.me.role !== "viewer");
  const dayKey = () => { const p = tzParts(new Date()); return `${p.y}-${p.m}-${p.d}`; };
  const mb = (b) => (b / 1024 / 1024).toLocaleString("hu-HU", { maximumFractionDigits: b < 100 * 1024 * 1024 ? 1 : 0 });
  const pct = (a, b) => Math.min(100, Math.round((a / b) * 1000) / 10);

  async function loadCache() {
    const c = await idb.get("kv", "usage").catch(() => null);
    if (c && c.uid === state.uid) { S.usage = c.usage; S.checkedDay = c.day; }
  }

  async function fetchUsage(force) {
    if (!isAdmin() || !navigator.onLine || !state.sb) return S.usage;
    if (!force && S.checkedDay === dayKey()) return S.usage;
    try {
      const { data, error } = await state.sb.rpc("storage_usage");
      if (error) throw error;
      S.usage = Object.assign({ at: new Date().toISOString() }, data);
      S.checkedDay = dayKey();
      await idb.put("kv", { uid: state.uid, usage: S.usage, day: S.checkedDay }, "usage").catch(() => {});
    } catch (e) {
      // A 7.5-ös SQL még nem futott le
      S.usage = null;
    }
    return S.usage;
  }

  // Kezdőlap: figyelmeztetés az adminnak, ha valamelyik tár 80% fölött van
  function homeHtml() {
    if (!isAdmin() || !S.usage) return "";
    const p = pct(S.usage.photos_bytes, LIMIT.photos), d = pct(S.usage.db_bytes, LIMIT.db);
    if (p < WARN * 100 && d < WARN * 100) return "";
    const which = p >= d ? `a fotótár ${p.toLocaleString("hu-HU")}%-ban` : `az adatbázis ${d.toLocaleString("hu-HU")}%-ban`;
    return `<button type="button" class="card home-alert warn" data-action="admin">⚠ Megtelőben: ${which} megtelt. Koppints a részletekért.</button>`;
  }

  // ------------------------------------------------------------------
  // Karbantartás nézet
  // ------------------------------------------------------------------
  async function open() {
    if (!isAdmin()) return;
    A.show("viewAdmin");
    renderUsage(true);
    renderBackupInfo();
    await fetchUsage(true);
    renderUsage(false);
  }

  function bar(label, used, limit) {
    const p = pct(used, limit);
    return `<div class="use-row"><div class="use-head"><span>${label}</span><b>${esc(mb(used))} MB / ${esc(mb(limit))} MB · ${esc(p.toLocaleString("hu-HU"))}%</b></div>
      <div class="use-bar"><span class="${p >= 90 ? "bad" : p >= WARN * 100 ? "warn" : ""}" style="width:${Math.max(1, p)}%"></span></div></div>`;
  }

  function renderUsage(loading) {
    const box = $("#adminUsage");
    if (!box) return;
    if (loading && !S.usage) { box.innerHTML = `<p class="hint">Betöltés…</p>`; return; }
    if (!S.usage) { box.innerHTML = `<p class="msg err">A tárhely lekérdezéséhez a 7.5-ös adatbázis-frissítés (supabase_frissites_v7_5.sql) szükséges.</p>`; return; }
    const u = S.usage;
    box.innerHTML = bar(`📷 Fotótár (${Number(u.photos_count).toLocaleString("hu-HU")} kép)`, Number(u.photos_bytes), LIMIT.photos) +
      bar("🗄 Adatbázis", Number(u.db_bytes), LIMIT.db) +
      `<p class="hint">Az ingyenes csomag korlátai: 1 GB fotótár, 500 MB adatbázis. 80% fölött a kezdőlapon figyelmeztetés jelenik meg. Mérve: ${esc(dtFmt(u.at))}.</p>`;
  }

  function lastBackup() { try { return localStorage.getItem("lastBackup"); } catch (_) { return null; } }
  function renderBackupInfo() {
    const el = $("#adminBackupInfo");
    if (!el) return;
    const l = lastBackup();
    const days = l ? Math.floor((Date.now() - new Date(l).getTime()) / 86400000) : null;
    el.innerHTML = l ? `Utolsó mentés ezen az eszközön: <b>${esc(dtFmt(l))}</b>${days >= 30 ? ` <span class="msg warn">(${days} napja – ideje újat menteni)</span>` : ""}`
      : `Ezen az eszközön még nem készült mentés.`;
  }

  async function fetchAll(table) {
    const PAGE = 1000;
    let rows = [];
    for (let from = 0; ; from += PAGE) {
      const r = await state.sb.from(table).select("*").range(from, from + PAGE - 1);
      if (r.error) {
        if (/does not exist|Could not find the table/i.test(r.error.message || "")) return null;   // régebbi adatbázis
        throw r.error;
      }
      rows = rows.concat(r.data || []);
      if (!r.data || r.data.length < PAGE) break;
    }
    return rows;
  }

  async function backup() {
    if (S.busy) return;
    if (!navigator.onLine) { toast("A mentéshez internetkapcsolat kell."); return; }
    const btn = $("#btnBackup"), msg = $("#adminBackupMsg");
    S.busy = true; btn.disabled = true; msg.className = "msg"; msg.textContent = "Mentés készül…";
    try {
      const data = {};
      const counts = [];
      for (const t of TABLES) {
        const rows = await fetchAll(t);
        if (rows) { data[t] = rows; counts.push(`${t}: ${rows.length}`); }
      }
      const now = new Date(), p = tzParts(now);
      const out = {
        app: "TFT Horgásznapló", version: A.APP_VERSION, created_at: now.toISOString(),
        created_by: (state.me && state.me.display_name) || "", note: "A fotók a Supabase fotótárban vannak; itt az útvonaluk szerepel.",
        tables: data
      };
      const blob = new Blob([JSON.stringify(out, null, 1)], { type: "application/json" });
      const name = `horgasznaplo_mentes_${p.y}${p.m}${p.d}_${p.h}${p.min}.json`;
      const file = typeof File === "function" ? new File([blob], name, { type: "application/json" }) : null;
      let shared = false;
      if (file && navigator.canShare && navigator.canShare({ files: [file] }) && /iPhone|iPad|Android/i.test(navigator.userAgent)) {
        try { await navigator.share({ files: [file], title: name }); shared = true; } catch (e) { if (e && e.name === "AbortError") { msg.textContent = "Mentés megszakítva."; return; } }
      }
      if (!shared) {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob); a.download = name;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 30000);
      }
      try { localStorage.setItem("lastBackup", now.toISOString()); } catch (_) { /* nincs tároló */ }
      msg.className = "msg ok";
      msg.textContent = `✓ Kész: ${name} (${(blob.size / 1024).toLocaleString("hu-HU", { maximumFractionDigits: 0 })} kB; ${data.catches ? data.catches.length : 0} fogás, ${data.trips ? data.trips.length : 0} túra).`;
      renderBackupInfo();
    } catch (e) {
      msg.className = "msg err"; msg.textContent = errText(e);
    } finally {
      S.busy = false; btn.disabled = false;
    }
  }

  document.addEventListener("click", (e) => {
    if (e.target.closest("#btnBackup")) { backup(); return; }
    if (e.target.closest("#btnAdminBack")) { A.show("viewMain"); if (state.tab === "tabHome") A.renderHome(); return; }
    if (e.target.closest("#btnUsageRefresh")) { fetchUsage(true).then(() => renderUsage(false)); }
  });

  function reset() { S.usage = null; S.checkedDay = null; }

  return { loadCache, fetchUsage, homeHtml, open, backup, reset, LIMIT };
};
