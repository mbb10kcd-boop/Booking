// Fælles UI-dele: ikoner, bookingkort, toasts, dialoger og referencedata (faciliteter/foreninger).
import { api } from "./api.js";
import {
  esc, hhmm, dayTimeLabel, isCancelled, isNow, isOver, nowLocal, stampToLocalNaive, minutesBetween, isMultiDay,
} from "./util.js";

const ICONS = {
  today: '<path d="M7 3v3M17 3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z"/><path d="M9 15l2 2 4-4"/>',
  list: '<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  pin: '<path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11z"/><circle cx="12" cy="10" r="2.5"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-6 8-6s8 2 8 6"/>',
  phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a1 1 0 0 1-1 1A16 16 0 0 1 4 5a1 1 0 0 1 1-1z"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
  note: '<path d="M6 3h9l4 4v14H6z"/><path d="M9 12h7M9 16h7"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  check: '<path d="M5 12l5 5 9-10"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13 7l4 4"/>',
  move: '<path d="M4 8h14l-3-3M20 16H6l3 3"/>',
  flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
  repeat: '<path d="M4 12a8 8 0 0 1 14-5l2 2M20 12a8 8 0 0 1-14 5l-2-2"/><path d="M20 4v5h-5M4 20v-5h5"/>',
  chevL: '<path d="M15 5l-7 7 7 7"/>',
  chevR: '<path d="M9 5l7 7-7 7"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M16 7l3 3"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14-4M4 5v4h4M4 13a8 8 0 0 0 14 4M20 19v-4h-4"/>',
  warn: '<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18h.01"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
  history: '<path d="M4 12a8 8 0 1 0 3-6.2M4 4v4h4"/><path d="M12 8v5l3 2"/>',
};
export function icon(name, cls = "") {
  return `<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ""}</svg>`;
}

// ---- Referencedata ----
export const ref = { fac: new Map(), orgs: new Map(), facList: [], orgList: [], loaded: false };
export function resetRef() { ref.fac = new Map(); ref.orgs = new Map(); ref.facList = []; ref.orgList = []; ref.loaded = false; }
export async function loadRef() {
  if (ref.loaded) return ref;
  const [facs, orgs] = await Promise.all([api.facilities(), api.organizations()]);
  ref.facList = facs.filter((f) => !f.archived);
  ref.fac = new Map(facs.map((f) => [f.id, f]));
  ref.orgList = orgs.filter((o) => !o.archived);
  ref.orgs = new Map(orgs.map((o) => [o.id, o]));
  ref.loaded = true;
  return ref;
}
export const facName = (id) => ref.fac.get(id)?.name ?? "Ukendt lokale";
export const facColor = (id) => ref.fac.get(id)?.color || "#2563eb";
export const orgName = (id) => (id ? ref.orgs.get(id)?.name ?? null : null);
export const responsible = (b) => b.contactName || orgName(b.organizationId) || "";

// ---- Status / mærkater ----
const UNCONFIRMED = new Set(["forespoergsel", "afventer_godkendelse", "reserveret", "midlertidig"]);
export function recency(b) {
  const created = stampToLocalNaive(b.createdAt);
  const updated = stampToLocalNaive(b.updatedAt);
  const now = nowLocal();
  const isNew = !!created && minutesBetween(created, now) < 48 * 60;
  const changed = !isNew && !!created && !!updated && minutesBetween(created, updated) > 5 && minutesBetween(updated, now) < 72 * 60;
  return { isNew, changed, created, updated };
}
export function badges(b, { compact = false } = {}) {
  const out = [];
  const now = nowLocal();
  if (isCancelled(b)) out.push(`<span class="badge b-cancel">${icon("x")}Aflyst</span>`);
  else {
    if (isNow(b, now)) out.push(`<span class="badge b-now"><span class="dot"></span>Nu</span>`);
    if (b.movedFromStartsAt) out.push(`<span class="badge b-moved">${icon("move")}Flyttet</span>`);
    const r = recency(b);
    if (r.isNew) out.push(`<span class="badge b-new">${icon("plus")}Ny</span>`);
    else if (r.changed && !b.movedFromStartsAt) out.push(`<span class="badge b-changed">${icon("edit")}Ændret</span>`);
    if (UNCONFIRMED.has(b.status)) out.push(`<span class="badge b-wait">${icon("clock")}Afventer</span>`);
  }
  if (b.important) out.push(`<span class="badge b-important">${icon("flag")}Vigtig/kamp</span>`);
  if (!compact && b.seasonGroupId) out.push(`<span class="badge b-season">${icon("repeat")}Sæson</span>`);
  return out.join("");
}

/** Bookingkort (link til detaljevisning). `day` bruges til tidstekst ved flerdagsbookinger. */
export function card(b, day) {
  const cancelled = isCancelled(b);
  const over = !cancelled && isOver(b);
  const who = responsible(b);
  const label = dayTimeLabel(b, day || b.startsAt.slice(0, 10));
  const cls = ["bk", cancelled ? "is-cancelled" : "", over ? "is-over" : "", !cancelled && isNow(b) ? "is-now" : ""].join(" ");
  return `<a class="${cls}" href="#/booking/${encodeURIComponent(b.id)}" style="--fc:${esc(facColor(b.facilityId))}" aria-label="${esc(label)} ${esc(b.title)}, ${esc(facName(b.facilityId))}${cancelled ? ", aflyst" : ""}">
    <div class="bk-time"><span class="t1">${esc(label.includes("–") ? hhmm(b.startsAt) : label)}</span>${label.includes("–") ? `<span class="t2">${esc(hhmm(b.endsAt))}</span>` : isMultiDay(b) ? `<span class="t2">flere dage</span>` : ""}</div>
    <div class="bk-main">
      <div class="bk-title">${esc(b.title)}</div>
      <div class="bk-meta"><span>${icon("pin")}${esc(facName(b.facilityId))}</span>${who ? `<span>${icon("user")}${esc(who)}</span>` : ""}</div>
      ${b.notes ? `<div class="bk-note">${icon("note")}${esc(b.notes)}</div>` : ""}
      ${cancelled && b.cancelReason ? `<div class="bk-note">Årsag: ${esc(b.cancelReason)}</div>` : ""}
      <div class="bk-badges">${badges(b)}</div>
    </div>
    <span class="bk-go">${icon("chevR")}</span>
  </a>`;
}

// ---- Toasts ----
export function toast(msg, kind = "ok") {
  const root = document.getElementById("toasts");
  const el = document.createElement("div");
  el.className = `toast t-${kind}`;
  el.innerHTML = `${icon(kind === "ok" ? "check" : "warn")}<span>${esc(msg)}</span>`;
  root.appendChild(el);
  setTimeout(() => el.classList.add("out"), 3800);
  setTimeout(() => el.remove(), 4300);
}

// ---- Dialog ----
export function openDialog({ title, body, actions }) {
  const root = document.getElementById("modal-root");
  const prevFocus = document.activeElement;
  root.innerHTML = `<div class="overlay" data-close="1"><div class="dialog" role="dialog" aria-modal="true" aria-labelledby="dlg-title">
    <h2 id="dlg-title">${esc(title)}</h2><div class="dlg-body">${body}</div>
    <p class="dlg-error" id="dlg-error" role="alert" hidden></p>
    <div class="dlg-actions">${actions.map((a, i) => `<button type="button" class="btn ${a.cls || ""}" data-act="${i}">${esc(a.label)}</button>`).join("")}</div>
  </div></div>`;
  const overlay = root.firstElementChild;
  const close = () => { root.innerHTML = ""; document.removeEventListener("keydown", onKey); prevFocus?.focus?.(); };
  const onKey = (e) => { if (e.key === "Escape") close(); };
  document.addEventListener("keydown", onKey);
  overlay.addEventListener("click", async (e) => {
    if (e.target === overlay) return close();
    const btn = e.target.closest("[data-act]");
    if (!btn) return;
    const act = actions[Number(btn.dataset.act)];
    const api2 = {
      close,
      setError(m) { const el = root.querySelector("#dlg-error"); el.textContent = m || ""; el.hidden = !m; },
      setBusy(on) { root.querySelectorAll("button").forEach((b) => (b.disabled = on)); btn.classList.toggle("busy", on); },
      root,
    };
    if (act.onClick) await act.onClick(api2); else close();
  });
  overlay.querySelector("button")?.focus();
  return { close };
}

export function errorBox(message, retryLabel = "Prøv igen") {
  return `<div class="notice n-error" role="alert">${icon("warn")}<div><strong>Noget gik galt</strong><p>${esc(message)}</p><button class="btn small" data-retry="1">${esc(retryLabel)}</button></div></div>`;
}
export const skeleton = (n = 3) => Array.from({ length: n }, () => '<div class="bk skel"><div class="bk-time"></div><div class="bk-main"><div class="sk-line w60"></div><div class="sk-line w40"></div></div></div>').join("");
