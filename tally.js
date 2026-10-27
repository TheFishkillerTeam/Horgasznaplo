/* =====================================================================
   Horgásznapló – Tabella (7.5 verzió)
   Közös táblázatok a túra Fogások fülére és az Összesítők „Horgász × halfaj”
   nézetére: összesítő (darab / össztömeg), egyedi súlyok, rangsor halfajonként.
   A vendégek fogása versenyen kívüli: külön sorban, helyezés nélkül.
   Az app.js hívja meg: window.TFTTally(api)
   ===================================================================== */
window.TFTTally = function (A) {
  "use strict";
  const { esc, numFmt, nameOf } = A;

  const w = (c) => (c.weight_kg == null || c.weight_kg === "" ? null : Number(c.weight_kg));
  const kgTxt = (v) => numFmt(Math.round(v * 100) / 100);
  const keyOf = (c) => (c.guest_name ? "g:" + String(c.guest_name).trim().toLowerCase() : "u:" + c.user_id);
  const nameOfKey = (c) => (c.guest_name ? String(c.guest_name).trim() : nameOf(c.user_id));

  // Horgászok (tagok előbb, darabszám, majd össztömeg szerint), halfajok (darabszám szerint)
  function prepare(list) {
    const anglers = new Map(), species = new Map();
    list.forEach((c) => {
      const k = keyOf(c);
      if (!anglers.has(k)) anglers.set(k, { key: k, name: nameOfKey(c), guest: !!c.guest_name, items: [] });
      anglers.get(k).items.push(c);
      const sp = String(c.species || "?").trim();
      species.set(sp, (species.get(sp) || 0) + 1);
    });
    const sum = (arr) => arr.reduce((s, c) => s + (w(c) || 0), 0);
    const rows = Array.from(anglers.values())
      .sort((a, b) => (a.guest ? 1 : 0) - (b.guest ? 1 : 0) || b.items.length - a.items.length ||
        sum(b.items) - sum(a.items) || a.name.localeCompare(b.name, "hu"));
    const spList = Array.from(species.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "hu")).map((x) => x[0]);
    return { rows, spList, sum };
  }
  const spOf = (c) => String(c.species || "?").trim();
  const guestTag = `<span class="tag guest">versenyen kívül</span>`;

  // 1. Összesítő: horgász × halfaj, cella = darab / össztömeg
  function summaryHtml(list) {
    if (!list.length) return `<p class="hint">Nincs fogás.</p>`;
    const { rows, spList, sum } = prepare(list);
    const cell = (arr) => {
      if (!arr.length) return `<span class="tl-zero">0</span>`;
      const s = sum(arr);
      return `<b>${arr.length} db</b>${s ? `<small>${esc(kgTxt(s))} kg</small>` : ""}`;
    };
    const members = rows.filter((r) => !r.guest).flatMap((r) => r.items);
    return `<div class="table-wrap tl-wrap"><table class="stats-table tl-table">
      <thead><tr><th class="tl-name">Horgász</th>${spList.map((sp) => `<th class="num">${esc(sp)}</th>`).join("")}<th class="num" title="Összesen">Össz.</th></tr></thead>
      <tbody>${rows.map((r) => `<tr class="${r.guest ? "tl-guest" : ""}"><td class="tl-name">${esc(r.name)}${r.guest ? `<small class="tl-out">versenyen kívül</small>` : ""}</td>
        ${spList.map((sp) => `<td class="num">${cell(r.items.filter((c) => spOf(c) === sp))}</td>`).join("")}
        <td class="num tl-total">${cell(r.items)}</td></tr>`).join("")}</tbody>
      ${rows.some((r) => !r.guest) && rows.filter((r) => !r.guest).length > 1 ? `<tfoot><tr><td class="tl-name">Csapat</td>
        ${spList.map((sp) => `<td class="num">${cell(members.filter((c) => spOf(c) === sp))}</td>`).join("")}
        <td class="num tl-total">${cell(members)}</td></tr></tfoot>` : ""}
    </table></div>`;
  }

  // 2. Egyedi súlyok: horgászonként és halfajonként, csökkenő sorrendben
  function weightsHtml(list) {
    if (!list.length) return `<p class="hint">Nincs fogás.</p>`;
    const { rows, spList } = prepare(list);
    return rows.map((r) => {
      const lines = spList.map((sp) => {
        const arr = r.items.filter((c) => spOf(c) === sp);
        if (!arr.length) return "";
        const ws = arr.map(w).filter((v) => v != null).sort((a, b) => b - a);
        const none = arr.length - ws.length;
        return `<li><span class="tl-sp">${esc(sp)}</span> <span class="tl-ws">${ws.map((v) => esc(kgTxt(v))).join(" · ")}${ws.length ? " kg" : ""}${none ? `${ws.length ? " · " : ""}<span class="hint">${none} súly nélkül</span>` : ""}</span></li>`;
      }).join("");
      return `<div class="tl-angler${r.guest ? " tl-guest" : ""}"><div class="tl-aname">${esc(r.name)}${r.guest ? guestTag : ""} <span class="hint">${r.items.length} db</span></div><ul class="tl-lines">${lines}</ul></div>`;
    }).join("");
  }

  // 3. Rangsor halfajonként: súly szerint, azonos súlynál azonos helyezés; vendég helyezés nélkül
  function rankHtml(list) {
    if (!list.length) return `<p class="hint">Nincs fogás.</p>`;
    const { spList } = prepare(list);
    return spList.map((sp) => {
      const arr = list.filter((c) => spOf(c) === sp && w(c) != null).sort((a, b) => w(b) - w(a));
      const noW = list.filter((c) => spOf(c) === sp && w(c) == null).length;
      if (!arr.length) return `<div class="tl-rank"><div class="tl-aname">${esc(sp)}</div><p class="hint">${noW} fogás, súly nélkül.</p></div>`;
      let place = 0, prev = null, n = 0;
      const items = arr.map((c) => {
        if (c.guest_name) return `<li class="tl-guest"><span class="tl-place">–</span> ${esc(nameOfKey(c))} <b>${esc(kgTxt(w(c)))}</b>${guestTag}</li>`;
        n += 1;
        if (w(c) !== prev) { place = n; prev = w(c); }
        const medal = place === 1 ? "🥇" : place === 2 ? "🥈" : place === 3 ? "🥉" : place + ".";
        return `<li><span class="tl-place">${medal}</span> ${esc(nameOfKey(c))} <b>${esc(kgTxt(w(c)))}</b></li>`;
      }).join("");
      return `<div class="tl-rank"><div class="tl-aname">${esc(sp)} <span class="hint">kg</span></div><ol class="tl-rlist">${items}</ol>${noW ? `<p class="hint">+ ${noW} súly nélkül</p>` : ""}</div>`;
    }).join("");
  }

  return { summaryHtml, weightsHtml, rankHtml };
};
