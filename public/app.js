/* make4yu Pitching dashboard. Reads /api/leads (the Google Sheet) and renders every view client-side. */
"use strict";

/* ---------- constants ---------- */
const STATUSES = [
  { key: "couldn't connect", label: "Couldn't connect", hex: "#8A958F", stage: 0 },
  { key: "not interested", label: "Not interested", hex: "#C2584A", stage: 1 },
  { key: "callback", label: "Callback", hex: "#E0A126", stage: 1 },
  { key: "interested", label: "Interested", hex: "#4CB06D", stage: 2 },
  { key: "sample sent", label: "Sample sent", hex: "#3AA39A", stage: 3 },
  { key: "client", label: "Client", hex: "#F2B33D", stage: 4 },
];
const STATUS = Object.fromEntries(STATUSES.map((s) => [s.key, s]));
const STAGES = ["Pitched", "Connected", "Interested", "Sample sent", "Clients"];

const FIELDS = {
  id: ["id"], date: ["date", "called on"], time: ["time"], caller: ["caller", "employee"],
  business: ["business", "business name", "name"], category: ["category", "niche"], city: ["city", "area"],
  phone: ["phone", "number", "mobile"], rating: ["google rating", "rating"], callSec: ["call (sec)", "call sec", "duration"],
  status: ["status", "result", "outcome"], objection: ["objection", "reason"],
  nextFollowUp: ["next follow-up", "next follow up", "follow-up"], sampleSentOn: ["sample sent on"],
  closedOn: ["closed on", "signed on"], plan: ["plan"], dealValue: ["deal value (inr)", "deal value"],
  carePlan: ["care plan (inr/mo)", "care plan"], notes: ["notes", "note"], recording: ["recording", "recording link"],
};

const TABS = [
  { id: "all", label: "All pitched", test: () => true },
  { id: "interested", label: "Interested", test: (r) => r.st === "interested" || r.st === "sample sent" },
  { id: "callback", label: "Callbacks", test: (r) => r.st === "callback" },
  { id: "not", label: "Not interested", test: (r) => r.st === "not interested" },
  { id: "noconnect", label: "Couldn't connect", test: (r) => r.st === "couldn't connect" },
  { id: "clients", label: "Current clients", test: (r) => r.st === "client" },
];

const PLAYBOOK = {
  steps: [
    { t: "Opener, about them", s: "Namaste sir, [Business] ke owner se baat ho rahi hai? Main [Name], make4yu se. Maine aapka business Google pe dekha, [4.8] stars aur itne saare reviews. Sach mein impressive hai, isliye call kiya.", w: "The first words are about them. Most lost calls ended in the first 20 seconds." },
    { t: "Permission", s: "Sir 30 second dunga, agar kaam ka na lage toh seedha bol dena, main phone rakh dunga. Theek hai?", w: "Offering a no makes people relax. Never ask \u201cdo you have 2 minutes?\u201d" },
    { t: "The question", s: "Jo log Google pe aapka profile dekhte hain, unhe fees, timings, photos ek jagah mil jaate hain? Ya unhe call karke poochna padta hai?", w: "Ask, then stop talking." },
    { t: "The insight", s: "Reviews aapke paas already best hain. Bas ek page chahiye jahan se log seedha enquiry bhejein. Warna wo us business pe chale jaate hain jiska sab clear dikh raha hai.", w: "They want customers, not a website." },
    { t: "The free offer", s: "Main aapke liye do free sample designs bana deta hoon, aapke reviews aur photos ke saath. WhatsApp pe bhej dunga. Pasand aaye toh baat karenge, warna delete kar dena.", w: "Both wins in the first batch came after this line. Say it in every call." },
    { t: "Close with a time", s: "Isi number pe WhatsApp hai? Kal shaam 6 baje tak bhej du, aur parso 5 minute saath mein dekh lenge?", w: "Never hang up without a time or a WhatsApp number." },
  ],
  objections: [
    { t: "\u201cGym ke liye website ka koi kaam nahi\u201d", k: ["doesn't need", "does not need", "koi kaam", "no use"], s: "Sir aapka experience mujhse zyada hai, log reviews aur Instagram dekh ke aate hain. Bas ek sawaal: unhe trial book karne ya fees jaanne ke liye abhi kya karna padta hai? Wahi step easy karna hai.", w: "If they still say no, thank them and move on." },
    { t: "\u201cNeed nahi hai\u201d or \u201cInstagram kaafi hai\u201d", k: ["no need", "need nahi", "instagram", "insta"], s: "Bilkul sir, Instagram se log aate hain, website usko replace nahi karti. Ye Google pe search karne walon ke liye hai, aur Instagram bio mein bhi yahi link lagta hai. Isliye free samples dikha raha hoon, dekh ke decide kijiye.", w: "The free samples answer this objection." },
    { t: "\u201cPehle se koi bana raha hai\u201d", k: ["vendor", "already", "someone"], s: "Badhiya sir! Phir bhi do free samples comparison ke liye rakh lijiye. Dono dekh ke jo better lage wo rakhna. Koi cost nahi.", w: "No pressure, just a comparison." },
    { t: "\u201cAbhi busy hoon\u201d", k: ["busy", "later", "baad", "call back"], s: "Zaroor sir. Aaj shaam 6 baje ya kal subah 11, kya better rahega?", w: "Always lock a time before hanging up." },
    { t: "\u201cKitna lagega?\u201d", k: ["price", "cost", "kitna", "expensive", "budget"], s: "Sir pehle samples dekh lo. Pasand aaye toh plan bataunga, aapke budget ke hisaab se options hain.", w: "Never give a price before they have seen the samples." },
  ],
  byStatus: {
    "couldn't connect": "Try again at a different hour. Open with their Google rating.",
    "callback": "Zaroor sir, aapne [time] bola tha, isliye call kiya. Bas 30 second, phir aap decide karna.",
    "interested": "Namaste sir, [Name] make4yu se. Jaise baat hui thi, aapke liye do free samples bana rahe hain. Kal tak WhatsApp pe bhej dunga.",
    "sample sent": "Sir, samples dekhe? Dono mein se kaunsa zyada pasand aaya? Usi ko final kar dete hain.",
    "client": "Check in on their care plan and ask for a referral.",
    "not interested": "Leave it for 60 days, then try once with a new angle.",
  },
};

/* ---------- state ---------- */
const store = {
  get: (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
const state = {
  rows: [], sheetUrl: "", view: store.get("m4y-view", "overview"), days: 0, caller: "", category: "",
  tab: "all", layout: "table", sort: { key: "date", dir: -1 }, goal: store.get("m4y-goal", 30), animated: false,
};
const charts = {};
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const inr = (n) => "\u20B9" + Math.round(n).toLocaleString("en-IN");
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
const DAY = 864e5;

/* ---------- parsing ---------- */
function parseDate(v) {
  if (!v) return null;
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/);
  if (m) return new Date(+m[3], +m[2] - 1, +m[1]);
  const d = new Date(s);
  return isNaN(d) ? null : new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
const num = (v) => { const n = parseFloat(String(v ?? "").replace(/[^\d.-]/g, "")); return isNaN(n) ? 0 : n; };
const today = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); };
const fmtDate = (d) => (d ? d.toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : "");
const fmtLong = (d) => (d ? d.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" }) : "");
const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const hourLabel = (h) => `${((h + 11) % 12) + 1} ${h < 12 ? "am" : "pm"}`;

function phoneDigits(p) {
  let d = String(p || "").replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  if (d.length === 10) d = "91" + d;
  return d;
}
function prettyPhone(p) {
  const d = phoneDigits(p);
  return d.length === 12 && d.startsWith("91") ? `+91 ${d.slice(2, 7)} ${d.slice(7)}` : String(p || "");
}

function normalize(raw, i) {
  const keys = Object.keys(raw);
  const r = { _i: i };
  for (const [f, names] of Object.entries(FIELDS)) {
    const k = keys.find((h) => names.includes(h.trim().toLowerCase()));
    r[f] = k ? String(raw[k] ?? "").trim() : "";
  }
  r.st = STATUS[r.status.toLowerCase()] ? r.status.toLowerCase() : "couldn't connect";
  r.s = STATUS[r.st];
  r.d = parseDate(r.date); r.fu = parseDate(r.nextFollowUp); r.sent = parseDate(r.sampleSentOn); r.closed = parseDate(r.closedOn);
  r.sec = num(r.callSec); r.deal = num(r.dealValue); r.care = num(r.carePlan);
  r.hour = /^\d{1,2}:/.test(r.time) ? parseInt(r.time, 10) : null;
  r.connected = r.st !== "couldn't connect";
  r.interested = ["interested", "sample sent", "client"].includes(r.st);
  r.sampled = r.st === "sample sent" || r.st === "client" || !!r.sent;
  r.client = r.st === "client";
  r.name = r.business || prettyPhone(r.phone) || "Unnamed lead";
  r.open = ["callback", "interested", "sample sent", "couldn't connect"].includes(r.st);
  return r;
}

/* ---------- loading ---------- */
async function load(manual = false) {
  $("synced").textContent = "Syncing";
  if (manual) { $("refresh").classList.remove("spin"); void $("refresh").offsetWidth; $("refresh").classList.add("spin"); }
  const demo = new URLSearchParams(location.search).has("demo");
  try {
    if (demo) throw Object.assign(new Error("demo"), { fallback: true });
    const res = await fetch("/api/leads", { credentials: "same-origin", cache: "no-store" });
    if (!(res.headers.get("content-type") || "").includes("json")) throw Object.assign(new Error("The data API did not answer. Open /api/leads to see why."), { fallback: ["localhost", "127.0.0.1"].includes(location.hostname) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `The API returned ${res.status}.`);
    $("notice").hidden = true;
    applyData(data);
    if (manual) toast(`Synced ${state.rows.length} leads from the sheet`);
  } catch (err) {
    if (err.fallback) {
      const data = await (await fetch("demo.json", { cache: "no-store" })).json();
      shiftDemoDates(data.rows);
      notice("You're looking at made-up sample data. Your real leads load here once the site runs on Cloudflare with the sheet connected.");
      applyData(data);
    } else {
      notice(err.message, true);
      $("synced").textContent = "Not synced";
    }
  }
}

// Keep the sample data fresh: move it so the latest call is today.
function shiftDemoDates(rows) {
  const dates = rows.map((r) => parseDate(r.Date)).filter(Boolean);
  if (!dates.length) return;
  const shift = Math.round((today() - new Date(Math.max(...dates))) / DAY);
  const move = (v) => { const d = parseDate(v); return d ? dayKey(new Date(d.getTime() + shift * DAY)) : v; };
  rows.forEach((r) => ["Date", "Next follow-up", "Sample sent on", "Closed on"].forEach((k) => { if (r[k]) r[k] = move(r[k]); }));
}

function applyData(data) {
  state.loaded = true;
  state.rows = (data.rows || []).map(normalize);
  state.sheetUrl = data.sheetUrl || "";
  $("sheetLink").href = state.sheetUrl || "#";
  $("sheetLink").hidden = !state.sheetUrl;
  const at = data.updatedAt && !new URLSearchParams(location.search).has("demo") ? new Date(data.updatedAt) : new Date();
  $("synced").textContent = `Synced at ${at.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}`;
  fillSelect("caller", uniq(state.rows.map((r) => r.caller)), "All callers");
  fillSelect("category", uniq(state.rows.map((r) => r.category)), "All categories");
  render();
}
const uniq = (a) => [...new Set(a.filter(Boolean))].sort();
function fillSelect(id, values, all) {
  $(id).innerHTML = `<option value="">${all}</option>` + values.map((v) => `<option${v === state[id] ? " selected" : ""}>${esc(v)}</option>`).join("");
}
function notice(msg, err = false) { const n = $("notice"); n.textContent = msg; n.hidden = false; n.classList.toggle("error", err); }
let toastT;
function toast(msg) { const t = $("toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("show"), 2600); }

/* ---------- filtering ---------- */
function scoped() { // caller + category only
  return state.rows.filter((r) => (!state.caller || r.caller === state.caller) && (!state.category || r.category === state.category));
}
function filtered() {
  const from = state.days ? today().getTime() - (state.days - 1) * DAY : null;
  return scoped().filter((r) => !from || (r.d && r.d.getTime() >= from));
}

/* ---------- render ---------- */
function render() {
  if (!state.loaded) return;
  const rows = filtered();
  header();
  const due = scoped().filter((r) => r.open && r.fu && r.fu <= today()).length;
  $("navDue").textContent = due; $("navDue").hidden = !due;
  ({ overview, followups, leads, clients, analytics, playbook }[state.view] || overview)(rows);
}

function header() {
  const h = new Date().getHours();
  $("greeting").textContent = h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
  const due = scoped().filter((r) => r.open && r.fu && r.fu <= today()).length;
  $("today").textContent = `${fmtLong(new Date())}. ${due ? `${due} follow-up${due > 1 ? "s are" : " is"} due.` : "No follow-ups due."}`;
}

function setView(v, push = true) {
  if (!document.querySelector(`.view[data-view="${v}"]`)) v = "overview";
  const swap = () => {
    state.view = v; store.set("m4y-view", v);
    document.querySelectorAll(".view").forEach((s) => s.classList.toggle("on", s.dataset.view === v));
    document.querySelectorAll("#nav button").forEach((b) => b.classList.toggle("on", b.dataset.view === v));
    render();
    window.scrollTo({ top: 0, behavior: "instant" });
  };
  if (push) history.replaceState(null, "", "#" + v);
  if (document.startViewTransition && !matchMedia("(prefers-reduced-motion: reduce)").matches) document.startViewTransition(swap);
  else swap();
}

/* ---------- overview ---------- */
function overview(rows) {
  pipeline(rows);
  kpis();
  goal();
  followList($("fuMini"), openLeads(scoped()).slice(0, 6));
  insights(rows);
  daysChart(rows);
}

function stageOf(r) { return STATUS[r.st].stage; }
function pipeline(rows) {
  const counts = [rows.length, rows.filter((r) => r.connected).length, rows.filter((r) => r.interested).length, rows.filter((r) => r.sampled).length, rows.filter((r) => r.client).length];
  const cols = $("pipeCols");
  const w = cols.clientWidth / 5 || 200;
  const animate = !state.animated && !matchMedia("(prefers-reduced-motion: reduce)").matches;
  cols.innerHTML = STAGES.map((name, k) => {
    const here = rows.filter((r) => Math.min(stageOf(r), 4) === k).sort((a, b) => STATUSES.indexOf(a.s) - STATUSES.indexOf(b.s));
    const rate = k === 0 ? "calls made" : `${pct(counts[k], counts[k - 1])}% of ${STAGES[k - 1].toLowerCase()}`;
    const dots = here.map((r, i) => `<button class="dot" type="button" data-i="${r._i}" style="--c:${r.s.hex};--from:${-(k * w + 40)}px;--d:${(k * 0.12 + Math.min(i, 40) * 0.025).toFixed(3)}s" aria-label="${esc(r.name)}, ${esc(r.s.label)}"></button>`).join("");
    return `<div class="col"><div class="col-top"><span class="col-name">${name}</span><span class="col-rate">${rate}</span></div>
      <div class="col-num" data-count="${counts[k]}">${animate ? 0 : counts[k]}</div><div class="dots${animate ? "" : " settled"}">${dots}</div></div>`;
  }).join("");
  $("pipeLegend").innerHTML = STATUSES.map((s) => `<span><i style="--c:${s.hex}"></i>${s.label}</span>`).join("");
  if (animate && rows.length) {
    state.animated = true;
    cols.querySelectorAll(".col-num").forEach((el, k) => countUp(el, +el.dataset.count, 900, k * 120));
    setTimeout(() => cols.querySelectorAll(".dots").forEach((d) => d.classList.add("settled")), 2200);
  }
}

function countUp(el, to, ms = 700, delay = 0, fmt = (v) => Math.round(v)) {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) { el.textContent = fmt(to); return; }
  setTimeout(() => {
    const t0 = performance.now();
    const step = (t) => {
      const p = Math.min(1, (t - t0) / ms), e = 1 - Math.pow(1 - p, 3);
      el.textContent = fmt(to * e);
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, delay);
}

function kpis() {
  const all = scoped(), rows = filtered(), t = today().getTime();
  const on = (d0, d1) => all.filter((r) => r.d && r.d.getTime() >= d0 && r.d.getTime() < d1).length;
  const tod = on(t, t + DAY), yest = on(t - DAY, t);
  const wk = on(t - 6 * DAY, t + DAY), lwk = on(t - 13 * DAY, t - 6 * DAY);
  const conn = rows.filter((r) => r.connected), int = rows.filter((r) => r.interested), cl = rows.filter((r) => r.client);
  const delta = (a, b) => { if (!b && !a) return `<small class="flat">no change</small>`; const d = a - b; return `<small class="${d > 0 ? "up" : d < 0 ? "down" : "flat"}">${d > 0 ? "+" : ""}${d} vs ${b}</small>`; };
  const items = [
    { l: "Calls today", v: tod, x: delta(tod, yest) },
    { l: "Calls in 7 days", v: wk, x: delta(wk, lwk) },
    { l: "Picked up", v: pct(conn.length, rows.length), suf: "%", x: `<small class="flat">${conn.length} of ${rows.length}</small>` },
    { l: "Interested", v: pct(int.length, conn.length), suf: "%", x: `<small class="flat">${int.length} of ${conn.length} who picked up</small>` },
    { l: "Clients", v: cl.length, x: `<small class="flat">${pct(cl.length, rows.length)}% of pitched</small>` },
    { l: "Project revenue", v: cl.reduce((s, r) => s + r.deal, 0), money: true, x: `<small class="flat">${inr(cl.reduce((s, r) => s + r.care, 0))} a month</small>` },
  ];
  $("kpis").innerHTML = items.map((k) => `<div class="kpi"><span>${k.l}</span><b data-v="${k.v}">0</b>${k.x}</div>`).join("");
  $("kpis").querySelectorAll("b").forEach((b, i) => countUp(b, +b.dataset.v, 700, i * 40, (v) => (items[i].money ? inr(v) : Math.round(v) + (items[i].suf || ""))));
}

function goal() {
  const t = today().getTime();
  const n = scoped().filter((r) => r.d && r.d.getTime() === t).length;
  const g = Math.max(1, state.goal);
  const p = Math.min(1, n / g);
  $("ringFg").style.strokeDashoffset = String(326.7 * (1 - p));
  $("ringFg").classList.toggle("done", n >= g);
  countUp($("goalNum"), n, 800);
  $("goalOf").textContent = `of ${g} calls`;
  const byDay = countBy(scoped().filter((r) => r.d), (r) => dayKey(r.d));
  const best = byDay[0];
  $("goalNote").textContent = n >= g ? "Goal reached. Every extra call is a bonus." : `${g - n} more call${g - n > 1 ? "s" : ""} to reach today's goal.${best ? ` Best day so far: ${best[1]} calls on ${fmtDate(parseDate(best[0]))}.` : ""}`;
}

function openLeads(rows) {
  const t = today().getTime();
  return rows.filter((r) => r.open && (r.fu || r.st !== "couldn't connect"))
    .sort((a, b) => (a.fu ? a.fu.getTime() : 9e15) - (b.fu ? b.fu.getTime() : 9e15) || (b.d?.getTime() ?? 0) - (a.d?.getTime() ?? 0));
}
function whenLabel(r) {
  if (!r.fu) return { txt: "No date set", cls: "" };
  const diff = Math.round((r.fu.getTime() - today().getTime()) / DAY);
  if (diff < 0) return { txt: `${-diff} day${diff < -1 ? "s" : ""} late`, cls: "late" };
  if (diff === 0) return { txt: "Today", cls: "today" };
  if (diff === 1) return { txt: "Tomorrow", cls: "" };
  return { txt: fmtDate(r.fu), cls: "" };
}
function followList(el, list, emptyMsg = "Nobody to call right now. New callbacks and interested leads show up here.") {
  el.innerHTML = list.length ? list.map((r) => {
    const w = whenLabel(r);
    const meta = [r.s.label, r.category, r.notes && r.notes.slice(0, 60)].filter(Boolean).map(esc).join(", ");
    return `<li class="fu" data-i="${r._i}" style="--c:${r.s.hex}"><div><div class="fu-who">${esc(r.name)}</div><div class="fu-meta">${meta}</div></div>
      <div class="fu-right"><span class="when ${w.cls}">${w.txt}</span>${contactLinks(r, true)}</div></li>`;
  }).join("") : `<li class="empty">${emptyMsg}</li>`;
}
function contactLinks(r, compact = false) {
  const d = phoneDigits(r.phone);
  if (!d) return "";
  const msg = encodeURIComponent(`Namaste sir, ${r.caller || "Sumit"} here from make4yu.`);
  return `<a class="act" href="tel:+${d}" aria-label="Call ${esc(r.name)}">Call</a><a class="act wa" href="https://wa.me/${d}?text=${msg}" target="_blank" rel="noopener" aria-label="WhatsApp ${esc(r.name)}">WhatsApp</a>`;
}

function insights(rows) {
  const out = [];
  if (!rows.length) { $("insights").innerHTML = `<li>No calls in this range yet. Widen the date range or add calls to the sheet.</li>`; return; }
  const conn = rows.filter((r) => r.connected), int = rows.filter((r) => r.interested), no = rows.filter((r) => r.st === "not interested");
  out.push(`<strong>${pct(int.length, conn.length)}%</strong> of people who picked up became interested (${int.length} of ${conn.length}).`);
  const objs = countBy(no.filter((r) => r.objection), (r) => r.objection);
  if (objs.length) out.push(`The most common no is <strong>\u201c${esc(objs[0][0])}\u201d</strong> (${objs[0][1]} of ${no.length}). Its answer is in the Playbook.`);
  const avg = (a) => (a.length ? Math.round(a.reduce((s, r) => s + r.sec, 0) / a.length) : 0);
  const ia = int.filter((r) => r.sec), na = no.filter((r) => r.sec);
  if (ia.length && na.length) out.push(`Interested calls ran <strong>${avg(ia)} seconds</strong> on average, a no ran <strong>${avg(na)}</strong>. Getting past the first 30 seconds is what matters.`);
  const hs = hourStats(rows).filter((h) => h.calls >= 3).sort((a, b) => b.rate - a.rate);
  if (hs.length) out.push(`Calls around <strong>${hourLabel(hs[0].h)}</strong> work best so far: ${Math.round(hs[0].rate * 100)}% turned interested.`);
  const late = scoped().filter((r) => r.open && r.fu && r.fu < today()).length;
  if (late) out.push(`<strong>${late}</strong> follow-up${late > 1 ? "s are" : " is"} overdue. Warm leads cool fast, so call them first.`);
  $("insights").innerHTML = out.map((s) => `<li>${s}</li>`).join("");
}

function countBy(arr, fn) {
  const m = new Map();
  arr.forEach((x) => { const k = fn(x); m.set(k, (m.get(k) || 0) + 1); });
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}
function hourStats(rows) {
  const m = new Map();
  rows.filter((r) => r.hour !== null).forEach((r) => { const s = m.get(r.hour) || { h: r.hour, calls: 0, int: 0 }; s.calls++; if (r.interested) s.int++; m.set(r.hour, s); });
  return [...m.values()].map((s) => ({ ...s, rate: s.int / s.calls })).sort((a, b) => a.h - b.h);
}

/* ---------- charts ---------- */
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
function chart(id, config) {
  if (!window.Chart) return;
  if (charts[id]) charts[id].destroy();
  charts[id] = new Chart($(id), config);
}
function opts({ stacked = false, legend = true, horizontal = false } = {}) {
  const muted = css("--muted"), grid = css("--grid");
  const axis = (g) => ({ stacked, grid: g ? { color: grid } : { display: false }, border: { display: false }, ticks: { color: muted, precision: 0 }, beginAtZero: true });
  return {
    responsive: true, maintainAspectRatio: false, indexAxis: horizontal ? "y" : "x",
    animation: { duration: 700, easing: "easeOutQuart" },
    plugins: { legend: { display: legend, position: "bottom", labels: { color: muted, boxWidth: 9, boxHeight: 9, usePointStyle: true, pointStyle: "circle", padding: 14 } },
      tooltip: { backgroundColor: css("--pine"), padding: 10, cornerRadius: 10, titleFont: { family: "Bricolage Grotesque", weight: "600" } } },
    scales: { x: axis(horizontal), y: axis(!horizontal) },
  };
}
function setChartFonts() { if (window.Chart) { Chart.defaults.font.family = "Instrument Sans, system-ui, sans-serif"; Chart.defaults.font.size = 12; } }

function daysChart(rows) {
  const dated = rows.filter((r) => r.d);
  const days = [];
  if (dated.length) {
    const max = new Date(Math.max(...dated.map((r) => r.d)));
    const min = new Date(Math.max(Math.min(...dated.map((r) => r.d)), max.getTime() - 29 * DAY));
    for (let d = new Date(min); d <= max; d.setDate(d.getDate() + 1)) days.push(dayKey(d));
  }
  const ds = STATUSES.map((s) => ({
    label: s.label, backgroundColor: s.hex, borderRadius: 4, borderSkipped: false, maxBarThickness: 30,
    data: days.map((k) => dated.filter((r) => r.st === s.key && dayKey(r.d) === k).length),
  })).filter((d) => d.data.some(Boolean));
  chart("cDays", { type: "bar", data: { labels: days.map((k) => fmtDate(parseDate(k))), datasets: ds }, options: opts({ stacked: true }) });
}

/* ---------- follow-ups ---------- */
function followups() {
  const list = openLeads(scoped()), t = today().getTime();
  const groups = [
    { h: "Late", f: (r) => r.fu && r.fu.getTime() < t, note: "Call these first." },
    { h: "Today", f: (r) => r.fu && r.fu.getTime() === t },
    { h: "Tomorrow", f: (r) => r.fu && r.fu.getTime() === t + DAY },
    { h: "Later this week", f: (r) => r.fu && r.fu.getTime() > t + DAY && r.fu.getTime() <= t + 7 * DAY },
    { h: "Later", f: (r) => r.fu && r.fu.getTime() > t + 7 * DAY },
    { h: "No date set", f: (r) => !r.fu, note: "Add a Next follow-up date in the sheet." },
  ];
  const retry = scoped().filter((r) => r.st === "couldn't connect" && !r.fu);
  $("fuGroups").innerHTML = groups.map((g) => {
    const items = list.filter(g.f);
    if (!items.length && g.h !== "Today") return "";
    return `<section class="panel"><header><h2>${g.h} <span class="sub">${items.length}</span></h2>${g.note && items.length ? `<p class="hint">${g.note}</p>` : ""}</header><ul class="fu-list" data-group="${g.h}"></ul></section>`;
  }).join("") + (retry.length ? `<section class="panel"><header><h2>Never reached <span class="sub">${retry.length}</span></h2><p class="hint">Try them at a different hour.</p></header><ul class="fu-list" data-group="retry"></ul></section>` : "");
  groups.forEach((g) => { const el = $("fuGroups").querySelector(`[data-group="${g.h}"]`); if (el) followList(el, list.filter(g.f), "Nothing due today. Check Tomorrow, or make new calls."); });
  const re = $("fuGroups").querySelector('[data-group="retry"]'); if (re) followList(re, retry);
}

/* ---------- leads ---------- */
const COLS = [
  { key: "name", label: "Lead", get: (r) => r.name.toLowerCase() },
  { key: "status", label: "Status", get: (r) => STATUSES.indexOf(r.s) },
  { key: "objection", label: "Objection", get: (r) => r.objection.toLowerCase(), cls: "hide-sm" },
  { key: "fu", label: "Follow up", get: (r) => r.fu?.getTime() ?? 9e15 },
  { key: "date", label: "Called", get: (r) => (r.d?.getTime() ?? 0) + (r.hour ?? 0) * 36e5, cls: "hide-sm" },
  { key: "sec", label: "Length", get: (r) => r.sec, cls: "hide-sm" },
  { key: "acts", label: "" },
];
function leadList(rows) {
  const tab = TABS.find((t) => t.id === state.tab) || TABS[0];
  const list = rows.filter(tab.test);
  const c = COLS.find((x) => x.key === state.sort.key && x.get) || COLS[4];
  return list.sort((a, b) => { const x = c.get(a), y = c.get(b); return (x > y ? 1 : x < y ? -1 : 0) * state.sort.dir; });
}
function leads(rows) {
  $("tabs").innerHTML = TABS.map((t) => `<button class="tab" role="tab" type="button" data-tab="${t.id}" aria-selected="${t.id === state.tab}">${t.label}<span class="n">${rows.filter(t.test).length}</span></button>`).join("");
  document.querySelectorAll("#layout button").forEach((b) => b.classList.toggle("on", b.dataset.layout === state.layout));
  $("tableWrap").hidden = state.layout !== "table";
  $("board").hidden = state.layout !== "board";
  if (state.layout === "board") return board(rows);
  const list = leadList(rows), t = today().getTime();
  const head = `<thead><tr>${COLS.map((c) => `<th class="${c.cls || ""}" data-key="${c.key}"${c.key === state.sort.key ? ` aria-sort="${state.sort.dir > 0 ? "ascending" : "descending"}"` : ""}>${c.label}</th>`).join("")}</tr></thead>`;
  const body = list.length ? list.map((r, i) => `<tr data-i="${r._i}" style="--i:${Math.min(i, 30)}">
      <td><div class="who">${esc(r.name)}</div><div class="sub">${esc([r.business ? prettyPhone(r.phone) : "", r.category, r.city].filter(Boolean).join(", "))}</div></td>
      <td><span class="chip" style="--c:${r.s.hex}">${r.s.label}</span></td>
      <td class="hide-sm">${esc(r.objection) || '<span class="sub">None</span>'}</td>
      <td>${r.fu ? `<span class="${r.open && r.fu.getTime() < t ? "late-txt" : ""}">${fmtDate(r.fu)}</span>` : '<span class="sub">None</span>'}</td>
      <td class="hide-sm">${fmtDate(r.d)}<div class="sub">${esc([r.time, r.caller].filter(Boolean).join(", "))}</div></td>
      <td class="hide-sm n">${r.sec ? r.sec + "s" : ""}</td>
      <td><div class="acts">${contactLinks(r)}</div></td></tr>`).join("")
    : `<tr><td colspan="${COLS.length}" class="empty">${emptyText()}</td></tr>`;
  $("leadsTable").innerHTML = head + `<tbody>${body}</tbody>`;
}
function emptyText() {
  return { clients: "No clients yet. Set a lead's Status to Client in the sheet and it appears here.", noconnect: "Everyone picked up. Log missed calls as Couldn't connect so they get retried.",
    callback: "No callbacks waiting.", interested: "No interested leads in this range yet.", not: "Nobody said no in this range." }[state.tab] || "No calls match these filters.";
}
function board(rows) {
  const tab = TABS.find((t) => t.id === state.tab) || TABS[0];
  const list = rows.filter(tab.test);
  $("board").innerHTML = STATUSES.map((s) => {
    const items = list.filter((r) => r.st === s.key).sort((a, b) => (a.fu?.getTime() ?? 9e15) - (b.fu?.getTime() ?? 9e15));
    return `<div class="lane" style="--c:${s.hex}"><h3><b>${s.label}</b><span>${items.length}</span></h3>${items.map((r) => {
      const w = whenLabel(r);
      return `<div class="card" data-i="${r._i}" style="--c:${s.hex}"><div class="who">${esc(r.name)}</div><div class="sub">${esc([r.category, r.objection].filter(Boolean).join(", "))}</div>${r.open && r.fu ? `<div class="when ${w.cls}">${w.txt}</div>` : ""}</div>`;
    }).join("") || '<p class="sub">Empty</p>'}</div>`;
  }).join("");
}
function exportCsv() {
  const list = state.view === "leads" ? leadList(filtered()) : filtered();
  const cols = ["date", "time", "caller", "business", "category", "city", "phone", "rating", "callSec", "status", "objection", "nextFollowUp", "plan", "dealValue", "carePlan", "notes"];
  const head = ["Date", "Time", "Caller", "Business", "Category", "City", "Phone", "Google rating", "Call (sec)", "Status", "Objection", "Next follow-up", "Plan", "Deal value (INR)", "Care plan (INR/mo)", "Notes"];
  const cell = (v) => (/[",\n]/.test(v) ? `"${String(v).replace(/"/g, '""')}"` : v);
  const csv = [head.join(","), ...list.map((r) => cols.map((c) => cell(r[c] || "")).join(","))].join("\n");
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob([csv], { type: "text/csv" })), download: `make4yu-leads-${dayKey(new Date())}.csv` });
  a.click(); URL.revokeObjectURL(a.href);
  toast(`Exported ${list.length} leads`);
}

/* ---------- clients ---------- */
function clients(rows) {
  const cl = rows.filter((r) => r.client);
  const deal = cl.reduce((s, r) => s + r.deal, 0), mrr = cl.reduce((s, r) => s + r.care, 0);
  const items = [
    { l: "Clients", v: cl.length }, { l: "Project revenue", v: deal, m: 1 }, { l: "Care plans a month", v: mrr, m: 1 },
    { l: "Average project", v: cl.length ? deal / cl.length : 0, m: 1 }, { l: "Pitched to client", v: pct(cl.length, rows.length), suf: "%" },
    { l: "Yearly care income", v: mrr * 12, m: 1 },
  ];
  $("clientKpis").innerHTML = items.map((k) => `<div class="kpi"><span>${k.l}</span><b data-v="${k.v}">0</b></div>`).join("");
  $("clientKpis").querySelectorAll("b").forEach((b, i) => countUp(b, +b.dataset.v, 700, i * 40, (v) => (items[i].m ? inr(v) : Math.round(v) + (items[i].suf || ""))));
  const when = (r) => r.closed || r.sent || r.d;
  const sorted = cl.filter(when).sort((a, b) => when(a) - when(b));
  let run = 0, runM = 0;
  chart("cRevenue", { type: "line", data: { labels: sorted.map((r) => fmtDate(when(r))), datasets: [
    { label: "Project revenue, running total", data: sorted.map((r) => (run += r.deal)), borderColor: css("--forest") || "#1D4A3D", backgroundColor: "rgba(62,154,92,.15)", fill: true, tension: .35, pointRadius: 4 },
    { label: "Care plans a month", data: sorted.map((r) => (runM += r.care)), borderColor: "#F2B33D", backgroundColor: "transparent", tension: .35, pointRadius: 4, borderDash: [5, 4] },
  ] }, options: { ...opts(), scales: { ...opts().scales, y: { ...opts().scales.y, ticks: { color: css("--muted"), callback: (v) => inr(v) } } } } });
  $("clientCards").innerHTML = cl.length ? cl.map((r) => `<article class="client" data-i="${r._i}"><h3>${esc(r.name)}</h3><div class="sub">${esc([r.plan || "Plan not set", r.category, r.city].filter(Boolean).join(", "))}</div>
      <div class="money"><div><b>${r.deal ? inr(r.deal) : "None"}</b><span>project</span></div><div><b>${r.care ? inr(r.care) : "None"}</b><span>care plan a month</span></div></div></article>`).join("")
    : `<p class="empty">No clients yet. When a lead signs, set its Status to Client and fill Plan, Deal value and Care plan in the sheet.</p>`;
}

/* ---------- analytics ---------- */
function analytics(rows) {
  heat(rows);
  const no = rows.filter((r) => r.st === "not interested" && r.objection);
  const objs = countBy(no, (r) => r.objection).slice(0, 7);
  chart("cObj", { type: "bar", data: { labels: objs.map((o) => o[0]), datasets: [{ label: "Times heard", data: objs.map((o) => o[1]), backgroundColor: "#C2584A", borderRadius: 6, maxBarThickness: 24 }] }, options: opts({ legend: false, horizontal: true }) });
  const buckets = [["Under 15s", 0, 15], ["15 to 30s", 15, 30], ["30 to 60s", 30, 60], ["1 to 1.5 min", 60, 90], ["Over 1.5 min", 90, 1e9]];
  const timed = rows.filter((r) => r.sec && r.connected);
  chart("cLen", { type: "bar", data: { labels: buckets.map((b) => b[0]), datasets: [
    { label: "Interested", data: buckets.map((b) => timed.filter((r) => r.interested && r.sec >= b[1] && r.sec < b[2]).length), backgroundColor: "#4CB06D", borderRadius: 4 },
    { label: "Not interested or callback", data: buckets.map((b) => timed.filter((r) => !r.interested && r.sec >= b[1] && r.sec < b[2]).length), backgroundColor: "#C9D3CD", borderRadius: 4 },
  ] }, options: opts({ stacked: true }) });
  breakdownTable("tCat", "Category", breakdown(rows, (r) => r.category));
  breakdownTable("tCaller", "Caller", breakdown(rows, (r) => r.caller));
}
function heat(rows) {
  const timed = rows.filter((r) => r.d && r.hour !== null);
  const hours = timed.length ? [Math.min(...timed.map((r) => r.hour)), Math.max(...timed.map((r) => r.hour))] : [10, 19];
  const hs = []; for (let h = Math.min(hours[0], 10); h <= Math.max(hours[1], 19); h++) hs.push(h);
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const cell = (d, h) => { const c = timed.filter((r) => (r.d.getDay() + 6) % 7 === d && r.hour === h); return { calls: c.length, int: c.filter((r) => r.interested).length }; };
  const all = days.flatMap((_, d) => hs.map((h) => cell(d, h)));
  const max = Math.max(1, ...all.map((c) => c.int));
  const el = $("heat");
  el.style.setProperty("--cols", hs.length);
  el.innerHTML = `<span></span>${hs.map((h) => `<span class="h">${h % 12 || 12}</span>`).join("")}` + days.map((dn, d) => `<span>${dn}</span>` + hs.map((h) => {
    const c = cell(d, h); const v = c.calls ? Math.max(0.12, c.int / max) : 0;
    return `<span class="cell" data-calls="${c.calls}" style="--v:${v.toFixed(2)}" data-tip="${dn} ${hourLabel(h)}|${c.calls} call${c.calls === 1 ? "" : "s"}, ${c.int} interested"></span>`;
  }).join("")).join("");
}
function breakdown(rows, fn) {
  const g = new Map();
  rows.forEach((r) => { const k = fn(r) || "Not set"; if (!g.has(k)) g.set(k, []); g.get(k).push(r); });
  return [...g.entries()].map(([k, a]) => ({ k, n: a.length, conn: a.filter((r) => r.connected).length, int: a.filter((r) => r.interested).length, cl: a.filter((r) => r.client).length })).sort((a, b) => b.n - a.n);
}
function breakdownTable(id, first, data) {
  const max = Math.max(1, ...data.map((d) => d.n));
  $(id).innerHTML = `<thead><tr><th>${first}</th><th>Pitched</th><th>Interested</th><th>Clients</th><th>Interest rate</th></tr></thead><tbody>` +
    (data.length ? data.map((d) => `<tr><td>${esc(d.k)}<span class="bar-in" style="width:${Math.round((d.n / max) * 56)}px"></span></td><td class="n">${d.n}</td><td class="n">${d.int}</td><td class="n">${d.cl}</td><td class="n">${pct(d.int, d.conn)}%</td></tr>`).join("")
      : `<tr><td colspan="5" class="empty">No calls in this range.</td></tr>`) + "</tbody>";
}

/* ---------- playbook ---------- */
function matchObjection(text) {
  const t = String(text || "").toLowerCase();
  return t ? PLAYBOOK.objections.find((o) => o.k.some((k) => t.includes(k))) : null;
}
function playbook(rows) {
  const no = rows.filter((r) => r.objection);
  $("play").innerHTML = `<div><h2>The pitch, in order</h2><div class="steps">${PLAYBOOK.steps.map((s) => `<div class="step"><h3>${s.t}</h3><p class="say">${esc(s.s)}</p><p class="why">${esc(s.w)}</p><button class="copy" type="button" data-copy="${esc(s.s)}">Copy line</button></div>`).join("")}</div></div>
    <div><h2>When they say no</h2>${PLAYBOOK.objections.map((o) => { const n = no.filter((r) => matchObjection(r.objection) === o).length;
      return `<div class="obj"><div class="obj-head"><h3>${o.t}</h3>${n ? `<span class="obj-count">Heard ${n} time${n > 1 ? "s" : ""}</span>` : ""}</div><p class="say">${esc(o.s)}</p><p class="why">${esc(o.w)}</p><button class="copy" type="button" data-copy="${esc(o.s)}">Copy reply</button></div>`; }).join("")}</div>`;
}

/* ---------- drawer ---------- */
let lastFocus = null;
function openDrawer(i) {
  const r = state.rows.find((x) => x._i === +i);
  if (!r) return;
  lastFocus = document.activeElement;
  const obj = matchObjection(r.objection);
  const next = obj ? obj.s : PLAYBOOK.byStatus[r.st];
  const w = whenLabel(r);
  const facts = [
    ["Status", `<span class="chip" style="--c:${r.s.hex}">${r.s.label}</span>`], ["Caller", esc(r.caller) || "Not set"],
    ["Called on", r.d ? `${fmtDate(r.d)}${r.time ? ", " + esc(r.time) : ""}` : "Not set"], ["Call length", r.sec ? `${r.sec} seconds` : "Not logged"],
    ["Follow up", r.fu ? `<span class="${r.open && w.cls === "late" ? "late-txt" : ""}">${w.txt}</span>` : "Not set"], ["Objection", esc(r.objection) || "None"],
  ];
  if (r.client) facts.push(["Project", r.deal ? inr(r.deal) : "Not set"], ["Care plan", r.care ? `${inr(r.care)} a month` : "None"]);
  const tl = [
    r.d && [r.d, `Pitched by ${esc(r.caller || "the team")}`, r.s.hex],
    r.sent && [r.sent, "Free samples sent", STATUS["sample sent"].hex],
    r.closed && [r.closed, `Signed${r.plan ? " on the " + esc(r.plan) + " plan" : ""}`, STATUS.client.hex],
    r.fu && r.open && [r.fu, "Next follow-up", r.fu < today() ? "#C2584A" : "#E0A126"],
  ].filter(Boolean).sort((a, b) => a[0] - b[0]);
  $("drawerBody").innerHTML = `
    <h2 class="d-title" id="dTitle">${esc(r.name)}</h2>
    <p class="d-sub">${esc([r.business ? prettyPhone(r.phone) : "", r.category, r.city, r.rating ? `${r.rating} stars on Google` : ""].filter(Boolean).join(", "))}</p>
    <div class="d-acts">${contactLinks(r)}${r.recording ? `<a class="act" href="${esc(r.recording)}" target="_blank" rel="noopener">Play recording</a>` : ""}${state.sheetUrl ? `<a class="act" href="${esc(state.sheetUrl)}" target="_blank" rel="noopener">Edit in sheet</a>` : ""}</div>
    <div class="facts">${facts.map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join("")}</div>
    ${r.notes ? `<div class="d-sec"><h3>Notes</h3><p>${esc(r.notes)}</p></div>` : ""}
    ${next ? `<div class="d-sec"><h3>${obj ? "Answer to their objection" : "What to say next"}</h3><p class="say">${esc(next)}</p><button class="copy" type="button" data-copy="${esc(next)}">Copy line</button></div>` : ""}
    ${tl.length ? `<div class="d-sec"><h3>History</h3><ul class="timeline">${tl.map(([d, t, c]) => `<li style="--c:${c}"><b>${fmtDate(d)}</b>, ${t}</li>`).join("")}</ul></div>` : ""}`;
  $("scrim").hidden = false;
  $("drawer").classList.add("open");
  $("drawer").setAttribute("aria-hidden", "false");
  setTimeout(() => $("drawerClose").focus(), 50);
}
function closeDrawer() {
  $("drawer").classList.remove("open");
  $("drawer").setAttribute("aria-hidden", "true");
  $("scrim").hidden = true;
  if (lastFocus) lastFocus.focus();
}

/* ---------- command palette ---------- */
let palSel = 0, palItems = [];
function openPalette() { $("palette").hidden = false; $("palInput").value = ""; palette(""); setTimeout(() => $("palInput").focus(), 20); }
function closePalette() { $("palette").hidden = true; }
function palette(q) {
  q = q.toLowerCase().trim();
  const views = [["overview", "Go to Overview"], ["followups", "Go to Follow-ups"], ["leads", "Go to Leads"], ["clients", "Go to Clients"], ["analytics", "Go to Analytics"], ["playbook", "Go to Playbook"]]
    .filter(([, l]) => !q || l.toLowerCase().includes(q)).map(([v, l]) => ({ type: "view", v, l, sub: "Page" }));
  const leadsHit = state.rows.filter((r) => !q || [r.name, r.phone, r.notes, r.objection, r.category, r.city, r.caller].join(" ").toLowerCase().includes(q))
    .slice(0, 12).map((r) => ({ type: "lead", i: r._i, l: r.name, sub: r.s.label }));
  palItems = q ? [...leadsHit, ...views] : [...views, ...leadsHit.slice(0, 6)];
  palSel = 0;
  drawPalette();
}
function drawPalette() {
  $("palList").innerHTML = palItems.length ? palItems.map((it, k) => `<li role="option" data-k="${k}" aria-selected="${k === palSel}"><span>${esc(it.l)}</span><span class="sub">${esc(it.sub)}</span></li>`).join("") : `<li class="empty">No matches. Try a phone number or business name.</li>`;
}
function pick(k) {
  const it = palItems[k]; if (!it) return;
  closePalette();
  if (it.type === "view") setView(it.v); else openDrawer(it.i);
}

/* ---------- tooltip ---------- */
function showTip(target, html) {
  const t = $("tip"); t.innerHTML = html; t.hidden = false;
  const b = target.getBoundingClientRect(), tw = t.offsetWidth;
  t.style.left = Math.max(8, Math.min(innerWidth - tw - 8, b.left + b.width / 2 - tw / 2)) + "px";
  t.style.top = (b.top - t.offsetHeight - 8 < 0 ? b.bottom + 8 : b.top - t.offsetHeight - 8) + "px";
}

/* ---------- events ---------- */
$("nav").addEventListener("click", (e) => { const b = e.target.closest("button[data-view]"); if (b) setView(b.dataset.view); });
document.addEventListener("click", (e) => {
  const go = e.target.closest("[data-goto]"); if (go) return setView(go.dataset.goto);
  if (e.target.closest("a")) return;
  const cp = e.target.closest("[data-copy]");
  if (cp) { navigator.clipboard?.writeText(cp.dataset.copy).then(() => toast("Copied")); return; }
  const item = e.target.closest("[data-i]");
  if (item && !e.target.closest("#palette")) openDrawer(item.dataset.i);
});
$("range").addEventListener("click", (e) => {
  const b = e.target.closest("button"); if (!b) return;
  state.days = +b.dataset.days;
  $("range").querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
  render();
});
$("caller").addEventListener("change", (e) => { state.caller = e.target.value; render(); });
$("category").addEventListener("change", (e) => { state.category = e.target.value; render(); });
$("tabs").addEventListener("click", (e) => { const b = e.target.closest(".tab"); if (!b) return; state.tab = b.dataset.tab; leads(filtered()); });
$("layout").addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; state.layout = b.dataset.layout; leads(filtered()); });
$("leadsTable").addEventListener("click", (e) => {
  const th = e.target.closest("th[data-key]"); if (!th || th.dataset.key === "acts") return;
  e.stopPropagation();
  state.sort = { key: th.dataset.key, dir: state.sort.key === th.dataset.key ? -state.sort.dir : 1 };
  leads(filtered());
});
$("exportCsv").addEventListener("click", exportCsv);
$("refresh").addEventListener("click", () => load(true));
$("themeBtn").addEventListener("click", () => {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  const apply = () => { document.documentElement.dataset.theme = next; try { localStorage.setItem("m4y-theme", next); } catch {} render(); };
  if (document.startViewTransition) document.startViewTransition(apply); else apply();
});
$("editGoal").addEventListener("click", () => {
  const v = parseInt(prompt("How many calls should the team make each day?", state.goal), 10);
  if (v > 0) { state.goal = v; store.set("m4y-goal", v); goal(); toast(`Daily goal set to ${v} calls`); }
});
$("drawerClose").addEventListener("click", closeDrawer);
$("scrim").addEventListener("click", closeDrawer);
$("openPalette").addEventListener("click", openPalette);
$("palette").addEventListener("click", (e) => { if (e.target.id === "palette") closePalette(); const li = e.target.closest("li[data-k]"); if (li) pick(+li.dataset.k); });
$("palInput").addEventListener("input", (e) => palette(e.target.value));
$("palInput").addEventListener("keydown", (e) => {
  if (e.key === "ArrowDown") { palSel = Math.min(palItems.length - 1, palSel + 1); drawPalette(); e.preventDefault(); }
  else if (e.key === "ArrowUp") { palSel = Math.max(0, palSel - 1); drawPalette(); e.preventDefault(); }
  else if (e.key === "Enter") pick(palSel);
});
document.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); $("palette").hidden ? openPalette() : closePalette(); }
  else if (e.key === "Escape") { if (!$("palette").hidden) closePalette(); else if ($("drawer").classList.contains("open")) closeDrawer(); }
  else if (e.key === "/" && !/input|textarea|select/i.test(document.activeElement.tagName)) { e.preventDefault(); openPalette(); }
});
document.addEventListener("pointerover", (e) => {
  const dot = e.target.closest(".dot");
  if (dot) { const r = state.rows.find((x) => x._i === +dot.dataset.i); if (r) showTip(dot, `<b>${esc(r.name)}</b>${esc(r.s.label)}${r.d ? ", called " + fmtDate(r.d) : ""}`); return; }
  const c = e.target.closest(".cell[data-tip]");
  if (c) { const [a, b] = c.dataset.tip.split("|"); showTip(c, `<b>${esc(a)}</b>${esc(b)}`); return; }
  $("tip").hidden = true;
});
document.addEventListener("focusin", (e) => { const dot = e.target.closest?.(".dot"); if (dot) dot.dispatchEvent(new PointerEvent("pointerover", { bubbles: true })); });
window.addEventListener("scroll", () => { $("tip").hidden = true; }, { passive: true });
let rz; window.addEventListener("resize", () => { clearTimeout(rz); rz = setTimeout(() => { if (state.view === "overview") pipeline(filtered()); }, 200); });
setInterval(() => { if (!document.hidden) load(); }, 5 * 60 * 1000);

/* ---------- start ---------- */
setChartFonts();
setView((location.hash || "").slice(1) || state.view, false);
load();
