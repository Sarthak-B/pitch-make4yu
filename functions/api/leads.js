// GET /api/leads — reads the "make4yu Pitch Tracker" Google Sheet live and returns it as JSON.
// Runs as a Cloudflare Pages Function. Every request is checked against Cloudflare Access
// unless ALLOW_PUBLIC is "true", so the pages.dev address never leaks lead data.

let cachedToken = { value: null, expires: 0 };
let cachedCerts = { keys: null, expires: 0 };

export async function onRequestGet({ request, env }) {
  try {
    if (env.ALLOW_PUBLIC !== "true") {
      if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) {
        return json({ error: "Cloudflare Access is not set up yet. Add the ACCESS_TEAM_DOMAIN and ACCESS_AUD secrets (README, step 5)." }, 401);
      }
      if (!(await verifyAccess(request, env))) {
        return json({ error: "Sign in through Cloudflare Access to view this dashboard." }, 401);
      }
    }
    if (!env.GOOGLE_SERVICE_ACCOUNT_JSON) throw new Error("the GOOGLE_SERVICE_ACCOUNT_JSON secret is missing");
    if (!env.SHEET_ID) throw new Error("the SHEET_ID secret is missing");

    const sa = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_JSON);
    const token = await googleToken(sa);
    const range = env.SHEET_RANGE || "Leads!A1:Z";
    const res = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${env.SHEET_ID}/values/${encodeURIComponent(range)}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) {
      return json({ error: `Google Sheets returned ${res.status}. Share the sheet with ${sa.client_email} as Viewer.` }, 502);
    }
    const { values = [] } = await res.json();
    const [header = [], ...body] = values;
    const rows = body
      .filter((r) => r.some((c) => String(c).trim() !== ""))
      .map((r) => Object.fromEntries(header.map((h, i) => [String(h).trim(), r[i] ?? ""])));

    return json({
      updatedAt: new Date().toISOString(),
      sheetUrl: `https://docs.google.com/spreadsheets/d/${env.SHEET_ID}/edit`,
      rows,
    });
  } catch (err) {
    return json({ error: `The dashboard API is not configured: ${err.message}.` }, 500);
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "private, no-store" },
  });
}

/* ---------- Google service-account auth (RS256 JWT with WebCrypto) ---------- */
const b64url = (buf) => {
  let s = "";
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const b64urlText = (s) => b64url(new TextEncoder().encode(s));

async function googleToken(sa) {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken.value && cachedToken.expires - 60 > now) return cachedToken.value;

  const header = b64urlText(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64urlText(JSON.stringify({
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/spreadsheets.readonly",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  }));
  const pem = sa.private_key.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${header}.${claims}`));

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${header}.${claims}.${b64url(sig)}`,
  });
  if (!res.ok) throw new Error(`the Google token request failed (${res.status})`);
  const data = await res.json();
  cachedToken = { value: data.access_token, expires: now + data.expires_in };
  return data.access_token;
}

/* ---------- Cloudflare Access JWT verification ---------- */
const fromB64url = (s) =>
  Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=")), (c) => c.charCodeAt(0));

async function verifyAccess(request, env) {
  let token = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!token) {
    const m = (request.headers.get("Cookie") || "").match(/CF_Authorization=([^;]+)/);
    token = m && m[1];
  }
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;

  const head = JSON.parse(new TextDecoder().decode(fromB64url(parts[0])));
  const payload = JSON.parse(new TextDecoder().decode(fromB64url(parts[1])));
  const team = `https://${env.ACCESS_TEAM_DOMAIN}`;
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (payload.iss !== team || !aud.includes(env.ACCESS_AUD) || payload.exp * 1000 < Date.now()) return false;

  if (!cachedCerts.keys || cachedCerts.expires < Date.now()) {
    const res = await fetch(`${team}/cdn-cgi/access/certs`);
    if (!res.ok) return false;
    cachedCerts = { keys: (await res.json()).keys, expires: Date.now() + 3600_000 };
  }
  const jwk = cachedCerts.keys.find((k) => k.kid === head.kid);
  if (!jwk) return false;
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  return crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, fromB64url(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
}
