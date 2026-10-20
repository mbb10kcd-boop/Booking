// Pedel-app: router, login, "I dag", "Bookinger" og detaljevisning.
import { api, ApiError, NetworkError, enableDemo, disableDemo, isDemo } from "./api.js";
import {
  esc, todayStr, nowLocal, addDaysStr, mondayOf, monthStart, addMonthsStr, daysInMonth, dow, isoWeek, MONTHS, DAYS_SHORT,
  fmtDateLongCap, fmtDateShort, relativeDayLabel, hhmm, onDay, isCancelled, isNow, isOver, dayTimeLabel, lastDay, isMultiDay,
  stampToLocalNaive, timeAgo, minutesBetween,
} from "./util.js";
import {
  icon, loadRef, resetRef, ref, facName, responsible, orgName, card, badges, recency, toast, openDialog, errorBox, skeleton,
} from "./ui.js";
import { renderForm } from "./form.js";

const $app = document.getElementById("app");
let user = null;
let renderToken = 0;
let refreshTimer = null;

const bust = () => ++renderToken;

// Brugerens navn gemmes lokalt, så forsiden ikke skal vente på et ekstra opslag. Ugyldigt login opdages af de almindelige datakald.
function readUser() { try { return JSON.parse(localStorage.getItem("pedel-user") || "null"); } catch { return null; } }
function saveUser(u) { try { if (u) localStorage.setItem("pedel-user", JSON.stringify(u)); else localStorage.removeItem("pedel-user"); } catch { /* ignorer */ } }
const $ = (sel, root = document) => root.querySelector(sel);

// Demo-banneret er sticky; topbaren skal ligge lige under det, uanset om teksten fylder 1 eller 2 linjer.
function syncBannerHeight() {
  const b = document.getElementById("demo-banner");
  document.documentElement.style.setProperty("--banner-h", b && !b.hidden ? `${b.offsetHeight}px` : "0px");
}
window.addEventListener("resize", syncBannerHeight);

// ---------- Skal / navigation ----------
function shell(active, inner, { back = null, title = "Pedel" } = {}) {
  const tab = (href, id, ic, label) =>
    `<a href="${href}" class="tab ${active === id ? "active" : ""}" ${active === id ? 'aria-current="page"' : ""}>${icon(ic)}<span>${label}</span></a>`;
  return `<header class="topbar">
      <div class="topbar-in">
        ${back ? `<a class="back" href="${esc(back)}" aria-label="Tilbage">${icon("chevL")}<span>Tilbage</span></a>` : `<div class="brand"><span class="logo">${icon("today")}</span><span>${esc(title)}<small>Grenaa Idrætscenter</small></span></div>`}
        <nav class="topnav" aria-label="Hovedmenu">
          ${tab("#/", "today", "today", "I dag")}${tab("#/bookinger", "list", "list", "Bookinger")}${tab("#/opret", "create", "plus", "Opret booking")}
        </nav>
        <div class="who">${user ? `<span class="who-name">${esc(user.name)}</span>` : ""}<button class="link" data-logout="1">Log ud</button></div>
      </div>
    </header>
    <main class="main" id="main">${inner}</main>
    <nav class="tabbar" aria-label="Hovedmenu">
      ${tab("#/", "today", "today", "I dag")}
      <a href="#/opret" class="tab tab-create ${active === "create" ? "active" : ""}" ${active === "create" ? 'aria-current="page"' : ""}><span class="fab">${icon("plus")}</span><span>Opret</span></a>
      ${tab("#/bookinger", "list", "list", "Bookinger")}
    </nav>`;
}
function setView(html) { $app.innerHTML = html; window.scrollTo(0, 0); }
function userMessage(err) {
  if (err instanceof NetworkError) return err.message;
  if (err instanceof ApiError) return err.data?.error && err.data.error !== "konflikt" ? err.data.error : `Bookingsystemet svarede med fejl (${err.status}).`;
  return "Der opstod en uventet fejl. Prøv igen.";
}
function handleAuth(err) {
  if (err instanceof ApiError && err.status === 401 && !isDemo()) {
    user = null;
    location.hash = "#/login";
    sessionStorage.setItem("pedel-login-msg", "Din session er udløbet – log ind igen.");
    return true;
  }
  return false;
}

// ---------- Login ----------
function renderLogin() {
  bust();
  const msg = sessionStorage.getItem("pedel-login-msg");
  sessionStorage.removeItem("pedel-login-msg");
  disableDemo();
  document.getElementById("demo-banner").hidden = true;
  document.body.classList.remove("is-demo");
  $app.innerHTML = `<main class="login">
    <div class="login-card">
      <div class="logo big">${icon("today")}</div>
      <h1>Pedel</h1><p class="sub">Grenaa Idrætscenter – bookinger</p>
      ${msg ? `<div class="notice n-warn">${icon("warn")}<div>${esc(msg)}</div></div>` : ""}
      <form id="login-form" novalidate>
        <label class="field"><span>E-mail</span><input type="email" name="email" autocomplete="username" inputmode="email" required></label>
        <label class="field"><span>Kodeord</span><input type="password" name="password" autocomplete="current-password" required></label>
        <p class="err" id="login-err" role="alert" hidden></p>
        <button class="btn primary block" type="submit">Log ind</button>
      </form>
      <button class="btn ghost block" id="demo-btn" type="button">Prøv med demo-data</button>
      <p class="hint">Demo-tilstanden bruger opdigtede bookinger og rører ikke det rigtige bookingsystem.</p>
    </div></main>`;
  const form = $("#login-form");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = form.email.value.trim(), password = form.password.value;
    const err = $("#login-err");
    err.hidden = true;
    if (!email || !password) { err.textContent = "Udfyld både e-mail og kodeord."; err.hidden = false; return; }
    const btn = form.querySelector("button");
    btn.disabled = true; btn.classList.add("busy");
    try {
      user = await api.login(email, password);
      saveUser(user);
      resetRef();
      location.hash = "#/";
      route();
    } catch (ex) {
      err.textContent = ex instanceof ApiError && ex.status === 401 ? "Forkert e-mail eller kodeord." : userMessage(ex);
      err.hidden = false;
    } finally { btn.disabled = false; btn.classList.remove("busy"); }
  });
  $("#demo-btn").addEventListener("click", async () => {
    await enableDemo(); resetRef();
    user = await api.me();
    document.getElementById("demo-banner").hidden = false;
    document.body.classList.add("is-demo");
    syncBannerHeight();
    location.hash = "#/";
    route();
  });
}

// ---------- I dag ----------
async function renderToday() {
  const token = bust();
  setView(shell("today", `<div class="page"><div class="skel-head"></div>${skeleton(3)}</div>`));
  try {
    const today = todayStr();
    // Kun det nødvendige hentes først (i dag + 3 dage). De seneste ændringer hentes bagefter, så forsiden vises hurtigt.
    const [, all, notes] = await Promise.all([loadRef(), api.bookings(`${today}T00:00:00`, `${addDaysStr(today, 3)}T23:59:59`), api.dayNotes(today, addDaysStr(today, 3))]);
    if (token !== renderToken) return;
    const dayB = all.filter((b) => onDay(b, today)).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    const active = dayB.filter((b) => !isCancelled(b));
    const cancelled = dayB.filter(isCancelled);
    const now = nowLocal();
    const nowList = active.filter((b) => isNow(b, now));
    const later = active.filter((b) => b.startsAt > now);
    const done = active.filter((b) => isOver(b, now));
    const weekday = fmtDateLongCap(today);
    const todayNotes = notes.filter((n) => n.date === today);

    const section = (title, items, cls = "") => items.length ? `<section class="group ${cls}"><h2>${title}<span class="count">${items.length}</span></h2><div class="cards">${items.map((b) => card(b, today)).join("")}</div></section>` : "";
    const tomorrowNotes = notes.filter((n) => n.date > today);

    const main = `
      <div class="page today">
        <div class="today-head">
          <div><p class="eyebrow">Uge ${isoWeek(today)}</p><h1>${esc(weekday)}</h1></div>
          <button class="icon-btn" data-reload="1" aria-label="Opdater">${icon("refresh")}</button>
        </div>
        <div class="stats" role="list">
          <div class="stat" role="listitem"><strong>${active.length}</strong><span>bookinger i dag</span></div>
          <div class="stat s-now" role="listitem"><strong>${nowList.length}</strong><span>i gang nu</span></div>
          <div class="stat s-later" role="listitem"><strong>${later.length}</strong><span>kommer senere</span></div>
          <div class="stat s-cancel" role="listitem"><strong>${cancelled.length}</strong><span>aflyst i dag</span></div>
        </div>
        <a class="btn primary big block" href="#/opret">${icon("plus")}Opret booking</a>
        ${todayNotes.map((n) => `<div class="notice n-note">${icon("flag")}<div><strong>Dagsnote</strong><p>${esc(n.text)}</p></div></div>`).join("")}
        <div class="cols">
          <div class="col-main">
            ${active.length === 0 ? `<div class="empty">${icon("check")}<p><strong>Ingen bookinger i dag</strong></p><p>Der er ikke noget på programmet.</p></div>` : ""}
            ${section("I gang nu", nowList, "g-now")}
            ${section("Kommer senere i dag", later, "g-later")}
            ${section("Afsluttet", done, "g-done")}
            ${section("Aflyst i dag", cancelled, "g-cancel")}
          </div>
          <aside class="col-side">
            <div id="changes-slot"><section class="panel"><h2>Seneste ændringer og aflysninger</h2><p class="muted">Henter …</p></section></div>
            ${tomorrowNotes.length ? `<section class="panel"><h2>Kommende dagsnoter</h2>${tomorrowNotes.map((n) => `<p class="note-line"><strong>${esc(fmtDateShort(n.date))}</strong> ${esc(n.text)}</p>`).join("")}</section>` : ""}
            ${renderUpcoming(all, today)}
          </aside>
        </div>
      </div>`;
    setView(shell("today", main));
    scheduleRefresh();
    loadChanges(token, today);
  } catch (err) {
    if (token !== renderToken || handleAuth(err)) return;
    setView(shell("today", `<div class="page">${errorBox(userMessage(err))}</div>`));
  }
}

async function loadChanges(token, today) {
  try {
    const wide = await api.bookings(`${addDaysStr(today, -3)}T00:00:00`, `${addDaysStr(today, 60)}T23:59:59`);
    if (token !== renderToken) return;
    const slot = document.getElementById("changes-slot");
    if (slot) slot.innerHTML = renderChanges(recentChanges(wide));
  } catch (err) {
    if (token !== renderToken) return;
    if (handleAuth(err)) return;
    const slot = document.getElementById("changes-slot");
    if (slot) slot.innerHTML = `<section class="panel"><h2>Seneste ændringer og aflysninger</h2><p class="muted">Kunne ikke hentes lige nu.</p></section>`;
  }
}

function recentChanges(all) {
  const now = nowLocal();
  const ev = [];
  for (const b of all) {
    const r = recency(b);
    if (isCancelled(b)) {
      // Tidsstemplet bruges kun, hvis det ikke ligger i fremtiden (ældre importerede aflysninger har en datoværdi i fremtiden).
      const at = b.cancelledAt && b.cancelledAt <= now ? b.cancelledAt : r.updated;
      if (at && minutesBetween(at, now) < 7 * 1440 && b.endsAt > now) ev.push({ type: "cancel", at, b });
    } else if (r.created && minutesBetween(r.created, now) < 7 * 1440) {
      ev.push({ type: "new", at: r.created, b });
    } else if (r.created && r.updated && minutesBetween(r.created, r.updated) > 5 && minutesBetween(r.updated, now) < 7 * 1440) {
      ev.push({ type: b.movedFromStartsAt ? "move" : "change", at: r.updated, b });
    }
  }
  return ev.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 8);
}
function renderChanges(list) {
  const meta = { cancel: ["x", "Aflyst", "c-cancel"], new: ["plus", "Ny booking", "c-new"], change: ["edit", "Ændret", "c-change"], move: ["move", "Flyttet", "c-move"] };
  return `<section class="panel"><h2>Seneste ændringer og aflysninger</h2>${list.length ? `<ul class="changes">${list.map((e) => {
    const [ic, label, cls] = meta[e.type];
    return `<li><a href="#/booking/${encodeURIComponent(e.b.id)}" class="chg ${cls}"><span class="chg-ic">${icon(ic)}</span><span class="chg-tx"><strong>${label}: ${esc(e.b.title)}</strong><small>${esc(fmtDateShort(e.b.startsAt.slice(0, 10)))} ${esc(hhmm(e.b.startsAt))} · ${esc(facName(e.b.facilityId))} · ${esc(timeAgo(e.at))}</small></span></a></li>`;
  }).join("")}</ul>` : `<p class="muted">Ingen ændringer de seneste 7 dage.</p>`}</section>`;
}
function renderUpcoming(all, today) {
  const days = [];
  for (let i = 1; i <= 3; i++) {
    const d = addDaysStr(today, i);
    const n = all.filter((b) => onDay(b, d) && !isCancelled(b)).length;
    days.push(`<a class="up-day" href="#/bookinger?view=dag&date=${d}"><span>${esc(relativeDayLabel(d))}</span><strong>${n}</strong></a>`);
  }
  return `<section class="panel"><h2>Kommende dage</h2><div class="up">${days.join("")}</div></section>`;
}
function scheduleRefresh() {
  clearInterval(refreshTimer);
  refreshTimer = setInterval(() => { if (!document.hidden && currentRoute().name === "today" && !document.getElementById("modal-root").firstChild) renderToday(); }, 120000);
}

// ---------- Bookinger (oversigt, søgning, filtre) ----------
const listState = { view: "dag", date: null, q: "", fac: "", status: "aktive", showCount: 60 };
const cache = { key: "", at: 0, rows: [] };

async function fetchRange(from, to) {
  const key = `${isDemo()}|${from}|${to}`;
  if (cache.key === key && Date.now() - cache.at < 20000) return cache.rows;
  const rows = await api.bookings(from, to);
  Object.assign(cache, { key, at: Date.now(), rows });
  return rows;
}
export function invalidateCache() { cache.key = ""; }

function rangeFor(state) {
  const d = state.date;
  if (state.q.trim().length >= 2) return { from: addDaysStr(todayStr(), -14), to: addDaysStr(todayStr(), 365), search: true };
  if (state.view === "dag") return { from: d, to: d };
  if (state.view === "uge") { const m = mondayOf(d); return { from: m, to: addDaysStr(m, 6) }; }
  const ms = monthStart(d); return { from: ms, to: addDaysStr(ms, daysInMonth(ms) - 1) };
}
function rangeLabel(state) {
  const d = state.date;
  if (state.view === "dag") return `${relativeDayLabel(d)}${d === todayStr() ? ` · ${fmtDateShort(d)}` : ""}`;
  if (state.view === "uge") { const m = mondayOf(d); const e = addDaysStr(m, 6); return `Uge ${isoWeek(m)} · ${Number(m.slice(8))}.–${Number(e.slice(8))}. ${MONTHS[Number(e.slice(5, 7)) - 1]}`; }
  return `${MONTHS[Number(d.slice(5, 7)) - 1][0].toUpperCase()}${MONTHS[Number(d.slice(5, 7)) - 1].slice(1)} ${d.slice(0, 4)}`;
}
function shiftDate(state, dir) {
  if (state.view === "dag") state.date = addDaysStr(state.date, dir);
  else if (state.view === "uge") state.date = addDaysStr(state.date, 7 * dir);
  else state.date = addMonthsStr(state.date, dir);
}
function matches(b, q) {
  const hay = [b.title, facName(b.facilityId), orgName(b.organizationId), b.contactName, b.contactPhone, b.notes, b.cancelReason].filter(Boolean).join(" ").toLowerCase();
  return q.toLowerCase().split(/\s+/).filter(Boolean).every((w) => hay.includes(w));
}
function applyFilters(rows, state) {
  const q = state.q.trim();
  const now = nowLocal();
  return rows.filter((b) => {
    if (state.fac && b.facilityId !== state.fac) return false;
    if (state.status === "aktive" && isCancelled(b)) return false;
    if (state.status === "aflyste" && !isCancelled(b)) return false;
    if (state.status === "aendrede") {
      const r = recency(b);
      const hit = isCancelled(b) ? (b.cancelledAt && minutesBetween(b.cancelledAt, now) < 7 * 1440) : (r.isNew || r.changed || b.movedFromStartsAt);
      if (!hit) return false;
    }
    if (q.length >= 2 && !matches(b, q)) return false;
    return true;
  });
}

async function renderList(query) {
  const token = bust();
  const p = new URLSearchParams(query || "");
  if (p.get("view")) listState.view = p.get("view");
  if (p.get("date")) listState.date = p.get("date");
  if (!listState.date) listState.date = todayStr();
  let facOptions = "";
  try {
    await loadRef();
    facOptions = ref.facList.map((f) => `<option value="${esc(f.id)}">${f.parentId ? "– " : ""}${esc(f.name)}</option>`).join("");
  } catch (err) {
    if (handleAuth(err)) return;
    setView(shell("list", `<div class="page">${errorBox(userMessage(err))}</div>`)); return;
  }
  if (token !== renderToken) return;
  setView(shell("list", `<div class="page">
    <h1 class="page-title">Bookinger</h1>
    <div class="filters">
      <label class="search">${icon("search")}<input type="search" id="q" placeholder="Søg booking, lokale eller ansvarlig" value="${esc(listState.q)}" autocomplete="off" aria-label="Søg"></label>
      <div class="filter-row">
        <label class="sel"><span>Lokale</span><select id="fac"><option value="">Alle lokaler</option>${facOptions}</select></label>
        <label class="sel"><span>Status</span><select id="status">
          <option value="aktive">Aktive</option><option value="alle">Alle (inkl. aflyste)</option><option value="aflyste">Kun aflyste</option><option value="aendrede">Nye/ændrede (7 dage)</option></select></label>
      </div>
    </div>
    <div id="rangebar"></div>
    <div id="results" class="results"></div></div>`));
  $("#fac").value = listState.fac; $("#status").value = listState.status;
  let t;
  $("#q").addEventListener("input", (e) => { clearTimeout(t); t = setTimeout(() => { listState.q = e.target.value; listState.showCount = 60; updateList(); }, 250); });
  $("#fac").addEventListener("change", (e) => { listState.fac = e.target.value; updateList(); });
  $("#status").addEventListener("change", (e) => { listState.status = e.target.value; updateList(); });
  updateList();
}

async function updateList() {
  const token = bust();
  const st = listState;
  const { from, to, search } = rangeFor(st);
  const bar = $("#rangebar"), res = $("#results");
  if (!bar || !res) return;
  if (search) {
    bar.innerHTML = `<div class="searchinfo">${icon("search")}<span>Søger i bookinger fra 14 dage tilbage til 1 år frem.</span><button class="link" data-clear-search="1">Ryd søgning</button></div>`;
  } else {
    bar.innerHTML = `<div class="seg" role="tablist" aria-label="Visning">${["dag", "uge", "maaned"].map((v) => `<button role="tab" aria-selected="${st.view === v}" class="${st.view === v ? "on" : ""}" data-view="${v}">${v === "maaned" ? "Måned" : v[0].toUpperCase() + v.slice(1)}</button>`).join("")}</div>
      <div class="datenav"><button class="icon-btn" data-nav="-1" aria-label="Forrige">${icon("chevL")}</button><div class="datelabel">${esc(rangeLabel(st))}</div><button class="icon-btn" data-nav="1" aria-label="Næste">${icon("chevR")}</button><button class="btn small" data-today="1">I dag</button></div>`;
  }
  res.innerHTML = skeleton(3);
  try {
    const rows = await fetchRange(`${from}T00:00:00`, `${to}T23:59:59`);
    if (token !== renderToken) return;
    renderResults(rows, from, to, search);
  } catch (err) {
    if (token !== renderToken || handleAuth(err)) return;
    res.innerHTML = errorBox(userMessage(err));
  }
}

function renderResults(rows, from, to, search) {
  const st = listState, res = $("#results");
  const hiddenCancelled = st.status === "aktive" ? rows.filter((b) => isCancelled(b) && (!st.fac || b.facilityId === st.fac) && (!st.q.trim() || matches(b, st.q.trim()))).length : 0;
  const filtered = applyFilters(rows, st);
  const hint = hiddenCancelled ? `<button class="hidden-hint" data-show-cancelled="1">${icon("x")}${hiddenCancelled} aflyst${hiddenCancelled === 1 ? "" : "e"} skjult – vis</button>` : "";

  if (!search && st.view === "maaned") { res.innerHTML = monthGrid(filtered, from) + hint; return; }

  // Gruppér pr. dag (flerdagsbookinger vises på hver dag).
  const days = new Map();
  const first = search ? todayStr() : from, last = search ? to : to;
  for (const b of filtered) {
    const s = b.startsAt.slice(0, 10), e = lastDay(b);
    let d = s < first ? first : s;
    const end = e > last ? last : e;
    for (; d <= end; d = addDaysStr(d, 1)) { if (!days.has(d)) days.set(d, []); days.get(d).push(b); }
  }
  if (!search && st.view === "dag" && !days.has(from)) days.set(from, []);
  if (!search && st.view === "uge") for (let i = 0; i < 7; i++) { const d = addDaysStr(from, i); if (!days.has(d)) days.set(d, []); }
  const keys = [...days.keys()].sort();
  if (!keys.length) { res.innerHTML = `<div class="empty">${icon("search")}<p><strong>${search ? "Ingen bookinger matcher søgningen" : "Ingen bookinger"}</strong></p><p>${search ? "Prøv et andet søgeord eller ryd filtrene." : "Der er ikke noget på programmet her."}</p></div>${hint}`; return; }
  let shown = 0, html = "";
  for (const d of keys) {
    const items = days.get(d).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    const act = items.filter((b) => !isCancelled(b)), can = items.filter(isCancelled);
    const slice = (arr) => { const room = Math.max(0, st.showCount - shown); const out = arr.slice(0, room); shown += out.length; return out; };
    const a = slice(act), c = slice(can);
    if (shown >= st.showCount && !a.length && !c.length) break;
    html += `<section class="day ${d === todayStr() ? "is-today" : ""}"><h2 class="day-h"><span>${esc(relativeDayLabel(d))}</span>${st.view === "dag" && !search ? "" : `<small>${esc(fmtDateShort(d))}</small>`}<span class="count">${act.length}</span></h2>
      ${items.length === 0 ? `<p class="muted pad">Ingen bookinger</p>` : ""}
      <div class="cards">${a.map((b) => card(b, d)).join("")}</div>
      ${c.length ? `<div class="cancel-sep">${icon("x")}Aflyst</div><div class="cards">${c.map((b) => card(b, d)).join("")}</div>` : ""}</section>`;
  }
  const total = [...days.values()].reduce((n, a2) => n + a2.length, 0);
  if (total > shown) html += `<button class="btn block" data-more="1">Vis flere (${total - shown} mere)</button>`;
  res.innerHTML = html + hint;
}

function monthGrid(rows, monthFirst) {
  const n = daysInMonth(monthFirst);
  const offset = (dow(monthFirst) + 6) % 7;
  const counts = {}, cancels = {};
  for (const b of rows) {
    for (let i = 0; i < n; i++) {
      const d = addDaysStr(monthFirst, i);
      if (onDay(b, d)) (isCancelled(b) ? cancels : counts)[d] = ((isCancelled(b) ? cancels : counts)[d] || 0) + 1;
    }
  }
  const head = ["man", "tir", "ons", "tor", "fre", "lør", "søn"].map((x) => `<div class="mh">${x}</div>`).join("");
  let cells = "";
  for (let i = 0; i < offset; i++) cells += `<div class="mc empty"></div>`;
  for (let i = 0; i < n; i++) {
    const d = addDaysStr(monthFirst, i);
    cells += `<button class="mc ${d === todayStr() ? "today" : ""} ${counts[d] ? "has" : ""}" data-goday="${d}" aria-label="${esc(fmtDateLongCap(d))}: ${counts[d] || 0} bookinger${cancels[d] ? `, ${cancels[d]} aflyst` : ""}"><span class="mn">${i + 1}</span>${counts[d] ? `<span class="mcount">${counts[d]}</span>` : ""}${cancels[d] ? `<span class="mcancel">${cancels[d]} ✕</span>` : ""}</button>`;
  }
  return `<div class="month"><div class="mgrid">${head}${cells}</div><p class="muted pad">Tryk på en dag for at se dagens bookinger.</p></div>`;
}

// ---------- Detaljevisning ----------
const ACTION_LABELS = { oprettet: "Oprettet", opdateret: "Opdateret", flyttet: "Flyttet", aflyst: "Aflyst" };
const STATUS_LABELS = { forespoergsel: "Forespørgsel", afventer_godkendelse: "Afventer godkendelse", reserveret: "Reserveret", bekraeftet: "Bekræftet", betalt: "Betalt", aflyst: "Aflyst", flyttet: "Flyttet", afvist: "Afvist", midlertidig: "Midlertidig" };

async function renderDetail(id, flash) {
  const token = bust();
  setView(shell("list", `<div class="page narrow">${skeleton(1)}</div>`, { back: "#/bookinger" }));
  try {
    const [, b] = await Promise.all([loadRef(), api.booking(id)]);
    if (token !== renderToken) return;
    const cancelled = isCancelled(b);
    const fac = ref.fac.get(b.facilityId);
    const s = b.startsAt.slice(0, 10), e = b.endsAt.slice(0, 10);
    const when = isMultiDay(b)
      ? `${fmtDateLongCap(s)} kl. ${hhmm(b.startsAt)}<br>til ${fmtDateLongCap(lastDay(b))} kl. ${hhmm(b.endsAt)}`
      : `${fmtDateLongCap(s)}<br><strong>${hhmm(b.startsAt)}–${hhmm(b.endsAt)}</strong>`;
    void e;
    const org = orgName(b.organizationId);
    const hist = (b.history || []).slice().sort((x, y) => (stampToLocalNaive(y.createdAt) || "").localeCompare(stampToLocalNaive(x.createdAt) || ""));
    const row = (ic, label, val) => val ? `<div class="kv"><span class="kv-ic">${icon(ic)}</span><div><small>${label}</small><div>${val}</div></div></div>` : "";
    const moved = b.movedFromStartsAt && !cancelled ? `<div class="notice n-move">${icon("move")}<div><strong>Flyttet</strong><p>Oprindeligt: ${esc(facName(b.movedFromFacilityId || b.facilityId))}, ${esc(fmtDateShort(b.movedFromStartsAt.slice(0, 10)))} kl. ${esc(hhmm(b.movedFromStartsAt))}.</p></div></div>` : "";
    const warnMsg = sessionStorage.getItem("pedel-warn");
    sessionStorage.removeItem("pedel-warn");
    setView(shell("list", `<div class="page narrow detail ${cancelled ? "is-cancelled" : ""}">
      ${warnMsg ? `<div class="notice n-warn">${icon("warn")}<div><strong>Bemærk</strong><p>${esc(warnMsg)}.</p></div></div>` : ""}
      ${flash ? `<div class="notice n-ok">${icon("check")}<div>${esc(flash)}</div></div>` : ""}
      ${cancelled ? `<div class="notice n-error">${icon("x")}<div><strong>Denne booking er aflyst</strong>${b.cancelReason ? `<p>Årsag: ${esc(b.cancelReason)}</p>` : ""}</div></div>` : ""}
      ${moved}
      <div class="detail-head" style="--fc:${esc(fac?.color || "#2563eb")}">
        <div class="badges">${badges(b)}</div>
        <h1>${esc(b.title)}</h1>
        <p class="when">${when}</p>
        <p class="status">Status: ${esc(STATUS_LABELS[b.status] || b.status)}</p>
      </div>
      <div class="panel kvs">
        ${row("pin", "Lokale", esc(facName(b.facilityId)))}
        ${row("user", "Ansvarlig", esc(b.contactName || ""))}
        ${row("user", "Forening", esc(org || ""))}
        ${row("phone", "Telefon", b.contactPhone ? `<a href="tel:${esc(b.contactPhone.replace(/\s+/g, ""))}">${esc(b.contactPhone)}</a>` : "")}
        ${row("mail", "E-mail", b.contactEmail ? `<a href="mailto:${esc(b.contactEmail)}">${esc(b.contactEmail)}</a>` : "")}
        ${row("note", "Praktiske noter", b.notes ? esc(b.notes).replace(/\n/g, "<br>") : "")}
        ${row("key", "Dørkode", b.accessCode ? `<code>${esc(b.accessCode)}</code>` : "")}
        ${b.seasonGroupId ? row("repeat", "Sæson", "Del af en sæsonbooking. Ændring og aflysning her gælder kun denne dag.") : ""}
      </div>
      ${cancelled ? "" : `<div class="actions">
        <a class="btn primary" href="#/rediger/${encodeURIComponent(b.id)}">${icon("edit")}Rediger booking</a>
        <button class="btn danger" id="cancel-btn">${icon("x")}Aflys booking</button></div>`}
      <section class="panel"><h2>${icon("history")} Historik</h2>${hist.length ? `<ul class="hist">${hist.map((h) => `<li><strong>${esc(ACTION_LABELS[h.action] || h.action)}</strong><small>${esc(fmtHist(h.createdAt))}${h.actorName ? " · " + esc(h.actorName) : ""}</small></li>`).join("")}</ul>` : `<p class="muted">Ingen registrerede ændringer.</p>`}</section>
    </div>`, { back: "#/bookinger" }));
    $("#cancel-btn")?.addEventListener("click", () => confirmCancel(b));
  } catch (err) {
    if (token !== renderToken || handleAuth(err)) return;
    const nf = err instanceof ApiError && err.status === 404;
    setView(shell("list", `<div class="page narrow">${nf ? `<div class="empty">${icon("search")}<p><strong>Bookingen findes ikke</strong></p><p>Den kan være slettet.</p><a class="btn" href="#/bookinger">Til bookinger</a></div>` : errorBox(userMessage(err))}</div>`, { back: "#/bookinger" }));
  }
}
function fmtHist(ts) {
  const l = stampToLocalNaive(ts);
  return l ? `${fmtDateShort(l.slice(0, 10))} kl. ${hhmm(l)}` : "";
}

function confirmCancel(b) {
  const org = orgName(b.organizationId);
  const will = [];
  if (b.contactEmail || (org && ref.orgs.get(b.organizationId)?.contactEmail)) will.push("Kontaktpersonen får besked om aflysningen på mail.");
  if (b.organizationId) will.push("Aflysningen kommer på den offentlige aflysningsliste.");
  if (b.accessCode) will.push("Dørkoden spærres.");
  openDialog({
    title: "Aflys booking?",
    body: `<div class="sum"><strong>${esc(b.title)}</strong><br>${esc(fmtDateShort(b.startsAt.slice(0, 10)))} · ${esc(dayTimeLabel(b, b.startsAt.slice(0, 10)))}<br>${esc(facName(b.facilityId))}${responsible(b) ? " · " + esc(responsible(b)) : ""}</div>
      ${will.length ? `<ul class="will">${will.map((w) => `<li>${esc(w)}</li>`).join("")}</ul>` : ""}
      ${b.seasonGroupId ? `<p class="hint">Kun denne ene dag aflyses – resten af sæsonen røres ikke.</p>` : ""}
      <label class="field"><span>Årsag (valgfri)</span><input type="text" id="cancel-reason" maxlength="120" placeholder="fx Kamp rykket, sygdom …"></label>
      <p class="hint">Bookingen slettes ikke – den markeres som aflyst og kan ses i historikken.</p>`,
    actions: [
      { label: "Behold booking" },
      { label: "Ja, aflys booking", cls: "danger", onClick: async (d) => {
        d.setError(""); d.setBusy(true);
        try {
          await api.cancel(b.id, d.root.querySelector("#cancel-reason").value.trim());
          invalidateCache();
          d.close();
          toast("Booking aflyst");
          renderDetail(b.id, "Bookingen er aflyst.");
        } catch (err) {
          d.setBusy(false);
          if (handleAuth(err)) { d.close(); return; }
          d.setError(userMessage(err) + " Bookingen er IKKE aflyst.");
        }
      } },
    ],
  });
}

// ---------- Router ----------
function currentRoute() {
  const raw = location.hash.replace(/^#/, "") || "/";
  const [path, query] = raw.split("?");
  const parts = path.split("/").filter(Boolean);
  if (!parts.length) return { name: "today" };
  if (parts[0] === "bookinger") return { name: "list", query };
  if (parts[0] === "opret") return { name: "create", query };
  if (parts[0] === "booking" && parts[1]) return { name: "detail", id: decodeURIComponent(parts[1]) };
  if (parts[0] === "rediger" && parts[1]) return { name: "edit", id: decodeURIComponent(parts[1]) };
  if (parts[0] === "login") return { name: "login" };
  return { name: "today" };
}
async function route() {
  clearInterval(refreshTimer);
  const r = currentRoute();
  if (r.name === "login") return renderLogin();
  if (!user) {
    const cached = isDemo() ? null : readUser();
    if (cached) {
      user = cached;
      api.me().then((u) => { user = u; saveUser(u); }).catch((e) => { if (e instanceof ApiError && e.status === 401) { user = null; saveUser(null); } });
    } else {
      try { user = await api.me(); saveUser(user); } catch { user = null; }
      if (!user) { location.hash = "#/login"; return renderLogin(); }
    }
  }
  const deps = { shell, setView, userMessage, handleAuth, invalidateCache, getUser: () => user, bust, getToken: () => renderToken, $ };
  switch (r.name) {
    case "today": return renderToday();
    case "list": return renderList(r.query);
    case "create": return renderForm(deps, { mode: "create", query: r.query });
    case "edit": return renderForm(deps, { mode: "edit", id: r.id });
    case "detail": return renderDetail(r.id);
  }
}

// ---------- Globale handlinger (event delegation) ----------
document.addEventListener("click", async (e) => {
  const t = e.target.closest("[data-view],[data-nav],[data-today],[data-goday],[data-more],[data-clear-search],[data-show-cancelled],[data-retry],[data-reload],[data-logout]");
  if (!t) return;
  const d = t.dataset;
  if ("logout" in d) {
    try { await api.logout(); } catch { /* ignorer – vi nulstiller alligevel lokalt */ }
    user = null; resetRef(); invalidateCache(); disableDemo(); saveUser(null);
    document.getElementById("demo-banner").hidden = true; document.body.classList.remove("is-demo");
    location.hash = "#/login"; return renderLogin();
  }
  if ("retry" in d || "reload" in d) { invalidateCache(); return route(); }
  if ("view" in d) { listState.view = d.view; return updateList(); }
  if ("nav" in d) { shiftDate(listState, Number(d.nav)); return updateList(); }
  if ("today" in d) { listState.date = todayStr(); return updateList(); }
  if ("goday" in d) { listState.date = d.goday; listState.view = "dag"; return updateList(); }
  if ("more" in d) { listState.showCount += 60; return updateList(); }
  if ("clearSearch" in d) { listState.q = ""; const q = $("#q"); if (q) q.value = ""; return updateList(); }
  if ("showCancelled" in d) { listState.status = "alle"; const s = $("#status"); if (s) s.value = "alle"; return updateList(); }
});
window.addEventListener("hashchange", route);
document.addEventListener("visibilitychange", () => { if (!document.hidden && currentRoute().name === "today" && user) { invalidateCache(); renderToday(); } });
route();
