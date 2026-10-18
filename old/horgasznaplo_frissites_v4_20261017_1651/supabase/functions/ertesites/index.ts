// =====================================================================
// TFT Horgásznapló – „ertesites” Edge Function
// Push-értesítés a többi tagnak: új fogásról és új (tervezett) túráról.
//
// Telepítés: Supabase → Edge Functions → Deploy a new function → Via Editor
// A függvény neve legyen pontosan: ertesites
// A teljes fájl tartalmát másold be, majd „Deploy function”.
// Külső könyvtár nem kell: a titkosítás a beépített WebCrypto-val készül.
// =====================================================================
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...CORS, "Content-Type": "application/json" } });

// ---------------------------------------------------------------------
// WEBPUSH-KEZDET – Web Push titkosítás (RFC 8291, aes128gcm) és VAPID (RFC 8292)
// ---------------------------------------------------------------------
const enc = new TextEncoder();

function b64uEncode(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64uDecode(str: string): Uint8Array {
  const s = str.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((str.length + 3) % 4);
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", ikm as BufferSource, "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: salt as BufferSource, info: info as BufferSource }, key, length * 8);
  return new Uint8Array(bits);
}

export type VapidKeys = { publicKey: string; privateJwk: JsonWebKey };

export async function generateVapidKeys(): Promise<VapidKeys> {
  const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey));
  const privateJwk = await crypto.subtle.exportKey("jwk", kp.privateKey);
  return { publicKey: b64uEncode(raw), privateJwk };
}

export async function vapidAuthHeader(endpoint: string, keys: VapidKeys, subject: string): Promise<string> {
  const aud = new URL(endpoint).origin;
  const header = b64uEncode(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64uEncode(enc.encode(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject })));
  const unsigned = `${header}.${claims}`;
  const key = await crypto.subtle.importKey("jwk", keys.privateJwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(unsigned) as BufferSource);
  return `vapid t=${unsigned}.${b64uEncode(sig)}, k=${keys.publicKey}`;
}

export async function encryptPayload(payload: Uint8Array, p256dh: string, authSecret: string): Promise<Uint8Array> {
  const uaPublic = b64uDecode(p256dh);
  const auth = b64uDecode(authSecret);
  const asKeys = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey("raw", asKeys.publicKey));
  const uaKey = await crypto.subtle.importKey("raw", uaPublic as BufferSource, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, asKeys.privateKey, 256));

  const keyInfo = concat(enc.encode("WebPush: info\0"), uaPublic, asPublic);
  const ikm = await hkdf(auth, shared, keyInfo, 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);

  const aesKey = await crypto.subtle.importKey("raw", cek as BufferSource, "AES-GCM", false, ["encrypt"]);
  const plaintext = concat(payload, new Uint8Array([2])); // utolsó rekord jelzése
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce as BufferSource }, aesKey, plaintext as BufferSource));

  const rs = new Uint8Array(4);
  new DataView(rs.buffer).setUint32(0, 4096);
  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, cipher);
}

export async function sendPush(
  sub: { endpoint: string; p256dh: string; auth: string },
  message: unknown, keys: VapidKeys, subject: string
): Promise<Response> {
  const body = await encryptPayload(enc.encode(JSON.stringify(message)), sub.p256dh, sub.auth);
  return fetch(sub.endpoint, {
    method: "POST",
    headers: {
      Authorization: await vapidAuthHeader(sub.endpoint, keys, subject),
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      TTL: String(24 * 3600),
      Urgency: "high"
    },
    body: body as unknown as BodyInit
  });
}
// WEBPUSH-VÉGE
// ---------------------------------------------------------------------

function serviceKey(): string {
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legacy) return legacy;
  const all = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (all) {
    try {
      const obj = JSON.parse(all);
      const v = obj.default || Object.values(obj)[0];
      if (typeof v === "string") return v;
    } catch (_) { /* nem JSON */ }
  }
  throw new Error("Nem található szerverkulcs a környezeti változók között.");
}

const fmtNum = (n: number | null, d = 2) =>
  n == null ? "" : Number(n).toLocaleString("hu-HU", { maximumFractionDigits: d });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey(), {
      auth: { persistSession: false, autoRefreshToken: false }
    });

    // A hívó azonosítása a saját bejelentkezési tokenjével
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: u, error: ue } = await admin.auth.getUser(token);
    if (ue || !u?.user) return json({ error: "Bejelentkezés szükséges." }, 401);
    const uid = u.user.id;
    const { data: me } = await admin.from("profiles").select("id, display_name, approved, is_admin").eq("id", uid).maybeSingle();
    if (!me?.approved) return json({ error: "Nincs jóváhagyott tagság." }, 403);

    const body = await req.json().catch(() => ({}));
    const action = body.action;

    // VAPID kulcspár: első használatkor létrejön, és az adatbázisban marad
    async function getKeys(): Promise<VapidKeys> {
      const { data } = await admin.from("app_secrets").select("value").eq("key", "vapid").maybeSingle();
      if (data?.value?.publicKey) return data.value as VapidKeys;
      const keys = await generateVapidKeys();
      const { error } = await admin.from("app_secrets").insert({ key: "vapid", value: keys });
      if (error) { // párhuzamos első hívás: a másik nyert
        const again = await admin.from("app_secrets").select("value").eq("key", "vapid").maybeSingle();
        if (again.data?.value?.publicKey) return again.data.value as VapidKeys;
        throw error;
      }
      return keys;
    }

    const subject = Deno.env.get("PUSH_CONTACT") || "mailto:" + (u.user.email || "admin@example.com");

    async function sendToMany(subs: { id: string; endpoint: string; p256dh: string; auth: string }[], msg: unknown) {
      const keys = await getKeys();
      let ok = 0, failed = 0, removed = 0;
      await Promise.all(subs.map(async (s) => {
        try {
          const r = await sendPush(s, msg, keys, subject);
          if (r.status === 404 || r.status === 410) {
            await admin.from("push_subscriptions").delete().eq("id", s.id);
            removed++;
          } else if (r.ok) ok++;
          else { failed++; console.warn("push hiba", r.status, await r.text()); }
        } catch (e) { failed++; console.warn("push kivétel", e); }
      }));
      return { ok, failed, removed };
    }

    if (action === "key") {
      const keys = await getKeys();
      return json({ publicKey: keys.publicKey });
    }

    if (action === "subscribe") {
      const s = body.subscription;
      if (!s?.endpoint || !s?.keys?.p256dh || !s?.keys?.auth) return json({ error: "Hiányos feliratkozás." }, 400);
      const { error } = await admin.from("push_subscriptions").upsert({
        endpoint: s.endpoint, p256dh: s.keys.p256dh, auth: s.keys.auth, user_id: uid,
        user_agent: (req.headers.get("user-agent") || "").slice(0, 200)
      }, { onConflict: "endpoint" });
      if (error) throw error;
      return json({ ok: true });
    }

    if (action === "unsubscribe") {
      if (body.endpoint) await admin.from("push_subscriptions").delete().eq("endpoint", body.endpoint).eq("user_id", uid);
      return json({ ok: true });
    }

    if (action === "test") {
      const { data: subs } = await admin.from("push_subscriptions").select("id, endpoint, p256dh, auth").eq("user_id", uid);
      if (!subs?.length) return json({ error: "Ezen a fiókon nincs bekapcsolt értesítés." }, 400);
      const r = await sendToMany(subs, {
        title: "🎣 Próba-értesítés",
        body: "Ha ezt látod, az értesítések működnek ezen a készüléken.",
        url: body.url || "./",
        tag: "teszt"
      });
      return json(r);
    }

    if (action === "new_catch") {
      if (!body.client_id) return json({ error: "Hiányzó azonosító." }, 400);
      // Csak egyszer, csak a rögzítő kérésére, csak friss fogásnál
      const { data: c } = await admin.from("catches")
        .update({ notified_at: new Date().toISOString() })
        .eq("client_id", body.client_id).eq("user_id", uid).is("notified_at", null)
        .gte("created_at", new Date(Date.now() - 3 * 86400000).toISOString())
        .select("*")
        .maybeSingle();
      if (!c) return json({ skipped: true });

      const time = new Date(c.caught_at).toLocaleString("hu-HU", {
        timeZone: "Europe/Budapest", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit"
      });
      const size = [c.weight_kg != null ? `${fmtNum(c.weight_kg)} kg` : "", c.length_cm != null ? `${fmtNum(c.length_cm, 1)} cm` : ""]
        .filter(Boolean).join(", ");
      let image: string | undefined;
      if (c.photo_path) {
        const { data: su } = await admin.storage.from("photos").createSignedUrl(c.photo_path, 7 * 86400);
        image = su?.signedUrl;
      }
      const msg = {
        title: c.guest_name
          ? `🎣 ${c.guest_name} (vendég): ${c.species}${size ? " – " + size : ""}`
          : `🎣 ${me.display_name}: ${c.species}${size ? " – " + size : ""}`,
        body: `${c.water} · ${time}${c.guest_name ? ` · rögzítette: ${me.display_name}` : ""}`,
        url: (body.url || "./") + "#fogas-" + c.client_id,
        image,
        tag: "fogas-" + c.client_id
      };
      const { data: subs } = await admin.from("push_subscriptions").select("id, endpoint, p256dh, auth").neq("user_id", uid);
      const r = await sendToMany(subs || [], msg);
      return json({ sent: r });
    }

    if (action === "new_trip") {
      if (!body.trip_id) return json({ error: "Hiányzó azonosító." }, 400);
      // Csak egyszer, csak a létrehozó kérésére, csak friss és még nem lezárult túránál
      const { data: t } = await admin.from("trips")
        .update({ notified_at: new Date().toISOString() })
        .eq("id", body.trip_id).eq("created_by", uid).is("notified_at", null)
        .gte("created_at", new Date(Date.now() - 3 * 86400000).toISOString())
        .gte("end_at", new Date().toISOString())
        .select("id, title, water, start_at, end_at")
        .maybeSingle();
      if (!t) return json({ skipped: true });
      const when = new Date(t.start_at).toLocaleString("hu-HU", {
        timeZone: "Europe/Budapest", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit"
      });
      const msg = {
        title: `🧭 Új túra: ${t.title}`,
        body: `${t.water} · ${when} · kiírta: ${me.display_name}. Jössz?`,
        url: (body.url || "./") + "#tura-" + t.id,
        tag: "tura-" + t.id
      };
      const { data: subs } = await admin.from("push_subscriptions").select("id, endpoint, p256dh, auth").neq("user_id", uid);
      const r = await sendToMany(subs || [], msg);
      return json({ sent: r });
    }

    return json({ error: "Ismeretlen művelet." }, 400);
  } catch (e) {
    console.error(e);
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
