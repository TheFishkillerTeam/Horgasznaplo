/* =====================================================================
   Horgásznapló – Ünnepek és emlékek: közös számítás (8.0 verzió)
   Ugyanezt a kódot használja az app (felugró ablak, kezdőlap) és az
   ertesites függvény (reggel 8-as értesítés) – a függvénybe a
   CELEBRATE-CORE jelölők közé másolva, változtatás nélkül.
   Nincs benne böngésző- vagy szerverfüggő rész.
   ===================================================================== */
// CELEBRATE-CORE-START
const TFTCelebrate = (() => {
  const pad = (n) => String(n).padStart(2, "0");

  // Budapesti naptári nap
  function bpDate(now) {
    const p = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Budapest", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" })
      .formatToParts(now).reduce((o, x) => { o[x.type] = x.value; return o; }, {});
    return { y: Number(p.year), m: Number(p.month), d: Number(p.day), h: Number(p.hour), key: `${p.year}-${p.month}-${p.day}` };
  }
  const isLeap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

  // Húsvétvasárnap (Gauss / Meeus–Jones–Butcher, Gergely-naptár)
  function easter(y) {
    const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
    const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
    return { m: month, d: day };
  }

  const HOLIDAYS = {
    christmas: { emoji: "🎄", title: "Áldott, békés karácsonyt!", text: "Boldog karácsonyt kíván a TFT csapata!" },
    newyear: { emoji: "🥂", title: "Boldog új évet!", text: "Sok nagy halat és szép túrákat kíván az új évre a TFT csapata!" },
    easter: { emoji: "🐣", title: "Kellemes húsvéti ünnepeket!", text: "Kellemes húsvétot kíván a TFT csapata!" },
    halloween: { emoji: "🎃", title: "Boldog halloweent!", text: "Ma éjjel a harcsák is maszkot húznak… 🦇" }
  };
  function holidayOf(y, m, d) {
    if (m === 12 && d === 24) return Object.assign({ key: "christmas" }, HOLIDAYS.christmas);
    if (m === 1 && d === 1) return Object.assign({ key: "newyear" }, HOLIDAYS.newyear);
    if (m === 10 && d === 31) return Object.assign({ key: "halloween" }, HOLIDAYS.halloween);
    const e = easter(y);
    if (m === e.m && d === e.d) return Object.assign({ key: "easter" }, HOLIDAYS.easter);
    return null;
  }

  // Magyar névsorrend: a keresztnév az utolsó szó
  const firstName = (name) => { const p = String(name || "").trim().split(/\s+/); return p[p.length - 1] || ""; };

  // Születésnap / névnap ma (február 29. nem szökőévben február 28-án)
  function matchDay(pm, pd, y, m, d) {
    if (!pm || !pd) return false;
    if (pm === 2 && pd === 29 && !isLeap(y)) return m === 2 && d === 28;
    return pm === m && pd === d;
  }
  const isMember = (p) => p && p.approved && p.role !== "viewer";
  function celebrants(profiles, date) {
    const mem = (profiles || []).filter(isMember);
    return {
      birthday: mem.filter((p) => matchDay(p.birth_month, p.birth_day, date.y, date.m, date.d)),
      nameday: mem.filter((p) => matchDay(p.nameday_month, p.nameday_day, date.y, date.m, date.d))
    };
  }

  // „Ma volt…”: korábbi évek ugyanezen napja. Túra (kezdőnapján) elsőbbséget kap,
  // különben a nap legnagyobb fogása (tag, nem vendég).
  function memories(trips, catches, date) {
    const byYear = new Map();
    const add = (y, item) => { if (!byYear.has(y)) byYear.set(y, { trips: [], catches: [] }); byYear.get(y)[item.k].push(item.v); };
    (trips || []).forEach((t) => { const s = bpDate(new Date(t.start_at)); if (s.m === date.m && s.d === date.d && s.y < date.y) add(s.y, { k: "trips", v: t }); });
    (catches || []).forEach((c) => {
      if (c.guest_name) return;
      const s = bpDate(new Date(c.caught_at));
      if (s.m === date.m && s.d === date.d && s.y < date.y) add(s.y, { k: "catches", v: c });
    });
    return Array.from(byYear.entries()).sort((a, b) => b[0] - a[0]).map(([y, g]) => {
      const years = date.y - y;
      if (g.trips.length) {
        const t = g.trips.slice().sort((a, b) => String(a.start_at).localeCompare(String(b.start_at)))[0];
        return { years, year: y, kind: "trip", trip: t, more: g.trips.length - 1, catchCount: g.catches.length };
      }
      const w = (c) => (c.weight_kg == null ? -1 : Number(c.weight_kg));
      const best = g.catches.slice().sort((a, b) => w(b) - w(a))[0];
      return { years, year: y, kind: "catch", catch: best, more: g.catches.length - 1 };
    });
  }
  const yearsText = (n) => (n === 1 ? "egy éve" : `${n} éve`);
  const kg = (v) => Number(v).toLocaleString("hu-HU", { maximumFractionDigits: 2 });
  function memoryLine(mem, nameOf) {
    if (mem.kind === "trip") return `${mem.trip.title}`;
    const c = mem.catch;
    return `${firstName(nameOf(c.user_id))} – ${String(c.species || "").toLowerCase()}${c.weight_kg != null ? `, ${kg(c.weight_kg)} kg` : ""} 🏆`;
  }

  const joinNames = (arr) => (arr.length <= 1 ? arr.join("") : arr.slice(0, -1).join(", ") + " és " + arr[arr.length - 1]);

  // A nap eseményei egy felhasználó szemszögéből (felugró ablakhoz és értesítéshez)
  function dayItems(uid, ctx) {
    const { date, profiles } = ctx;
    const nameOf = ctx.nameOf || ((id) => ((profiles || []).find((p) => p.id === id) || {}).display_name || "");
    const cel = celebrants(profiles, date);
    const items = [];
    const people = (list, theme, ownTitle, otherVerb) => {
      const own = list.find((p) => p.id === uid);
      if (own) items.push({ theme, own: true, title: `${theme === "birthday" ? "🎂" : "🌷"} ${ownTitle}, ${firstName(own.display_name)}!`,
        text: theme === "birthday" ? "Sok szép fogást és nagy halakat kíván a TFT csapata!" : "Boldog névnapot kíván a TFT csapata!" });
      const others = list.filter((p) => p.id !== uid).map((p) => firstName(p.display_name));
      if (others.length) items.push({ theme, own: false,
        title: `${theme === "birthday" ? "🎂" : "🌷"} Ma VAN ${joinNames(others)} ${otherVerb}`,
        text: others.length > 1 ? "Köszöntsd fel őket!" : "Köszöntsd fel!" });
    };
    people(cel.birthday, "birthday", "Boldog születésnapot", "születésnapja!");
    people(cel.nameday, "nameday", "Boldog névnapot", "névnapja!");
    const hol = holidayOf(date.y, date.m, date.d);
    if (hol) items.push({ theme: hol.key, own: false, title: `${hol.emoji} ${hol.title}`, text: hol.text });
    // A saját ünnep áll elöl
    items.sort((a, b) => (b.own ? 1 : 0) - (a.own ? 1 : 0));
    const mem = memories(ctx.trips, ctx.catches, date);
    return { items, memories: mem, memoryText: mem.length ? memoryPush(mem, nameOf) : "" };
  }
  function memoryPush(mem, nameOf) {
    const first = mem[0];
    let t = `📅 Ma ${yearsText(first.years)}: ${memoryLine(first, nameOf)}`;
    if (mem.length === 2) t += ` – és ${yearsText(mem[1].years)} is történt valami!`;
    else if (mem.length > 2) t += " – és korábbi években is történt valami!";
    return t;
  }

  // Egyetlen napi értesítés (naponta legfeljebb egy): cím = az első esemény, szöveg = a többi
  function composePush(uid, ctx) {
    const r = dayItems(uid, ctx);
    const lines = r.items.map((i) => i.title + (i.own ? "" : i.theme === "birthday" || i.theme === "nameday" ? " " + i.text : ""));
    if (r.memoryText) lines.push(r.memoryText);
    if (!lines.length) return null;
    return { title: lines[0], body: lines.slice(1).join("\n") || (r.items[0] ? r.items[0].text : "Nézd meg az appban!") };
  }

  return { bpDate, easter, holidayOf, firstName, celebrants, memories, memoryLine, yearsText, dayItems, composePush, isLeap, pad };
})();
// CELEBRATE-CORE-END
if (typeof window !== "undefined") window.TFTCelebrate = TFTCelebrate;
