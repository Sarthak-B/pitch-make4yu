// Exports the Leads tab of the make4yu Pitch Tracker to backups/leads-YYYY-MM-DD.csv.
import { createSign } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";

const sa = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON || "{}");
const { SHEET_ID, SHEET_RANGE = "Leads!A1:Z", BACKUP_DIR = "backups" } = process.env;
if (!sa.client_email || !SHEET_ID) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON and SHEET_ID are required");

const b64 = (o) => Buffer.from(typeof o === "string" ? o : JSON.stringify(o)).toString("base64url");
const now = Math.floor(Date.now() / 1000);
const unsigned = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({
  iss: sa.client_email,
  scope: "https://www.googleapis.com/auth/spreadsheets.readonly",
  aud: "https://oauth2.googleapis.com/token",
  iat: now,
  exp: now + 3600,
})}`;
const signature = createSign("RSA-SHA256").update(unsigned).sign(sa.private_key).toString("base64url");

const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${unsigned}.${signature}`,
});
if (!tokenRes.ok) throw new Error(`Token request failed: ${tokenRes.status} ${await tokenRes.text()}`);
const { access_token } = await tokenRes.json();

const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(SHEET_RANGE)}`, {
  headers: { Authorization: `Bearer ${access_token}` },
});
if (!res.ok) throw new Error(`Sheets request failed: ${res.status} ${await res.text()}`);
const { values = [] } = await res.json();

const cell = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v ?? ""));
const csv = values.map((r) => r.map(cell).join(",")).join("\n") + "\n";
mkdirSync(BACKUP_DIR, { recursive: true });
const file = `${BACKUP_DIR}/leads-${new Date().toISOString().slice(0, 10)}.csv`;
writeFileSync(file, csv);
console.log(`Saved ${values.length - 1} rows.`); // no file path or data in the public log
