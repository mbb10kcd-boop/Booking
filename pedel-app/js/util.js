// Hjælpefunktioner: datoer, tider og flerdagsbookinger.
// Bookinger gemmes i backend som "naive" lokale tidsstrenge ("2026-10-19T18:00:00").
// Alt her regner derfor med tekststrenge i dansk tid (Europe/Copenhagen) - aldrig toISOString() på lokale tider.

export const TZ = "Europe/Copenhagen";
export const DAYS = ["søndag", "mandag", "tirsdag", "onsdag", "torsdag", "fredag", "lørdag"];
export const DAYS_SHORT = ["søn", "man", "tir", "ons", "tor", "fre", "lør"];
export const MONTHS = ["januar", "februar", "marts", "april", "maj", "juni", "juli", "august", "september", "oktober", "november", "december"];

const partsFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
});

/** Dato-tid i dansk tid som naiv streng "YYYY-MM-DDTHH:mm:ss". */
export function dateToLocalNaive(d) {
  const p = {};
  for (const x of partsFmt.formatToParts(d)) p[x.type] = x.value;
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`;
}
export const nowLocal = () => dateToLocalNaive(new Date());
export const todayStr = () => nowLocal().slice(0, 10);

function utcDate(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
export function addDaysStr(dateStr, n) {
  const dt = utcDate(dateStr);
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}
export const dow = (dateStr) => utcDate(dateStr).getUTCDay(); // 0=søndag
export function mondayOf(dateStr) {
  const d = dow(dateStr);
  return addDaysStr(dateStr, d === 0 ? -6 : 1 - d);
}
export function monthStart(dateStr) { return dateStr.slice(0, 7) + "-01"; }
export function addMonthsStr(dateStr, n) {
  const [y, m] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1 + n, 1));
  return dt.toISOString().slice(0, 10);
}
export function daysInMonth(dateStr) {
  const [y, m] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}
export function isoWeek(dateStr) {
  const d = utcDate(dateStr);
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
}
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
export function fmtDateLong(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return `${DAYS[dow(dateStr)]} ${d}. ${MONTHS[m - 1]}${y !== Number(todayStr().slice(0, 4)) ? " " + y : ""}`;
}
export const fmtDateLongCap = (s) => cap(fmtDateLong(s));
export function fmtDateShort(dateStr) {
  const [, m, d] = dateStr.split("-").map(Number);
  return `${DAYS_SHORT[dow(dateStr)]} ${d}/${m}`;
}
export const hhmm = (iso) => iso.slice(11, 16).replace(":", ".");
export function relativeDayLabel(dateStr) {
  const t = todayStr();
  if (dateStr === t) return "I dag";
  if (dateStr === addDaysStr(t, 1)) return "I morgen";
  if (dateStr === addDaysStr(t, -1)) return "I går";
  return fmtDateLongCap(dateStr);
}

/** Tidsstempler fra databasen: "YYYY-MM-DD HH:MM:SS" (UTC) eller ISO med Z -> naiv dansk tid. */
export function stampToLocalNaive(s) {
  if (!s) return null;
  if (/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(s)) return dateToLocalNaive(new Date(s.replace(" ", "T") + "Z"));
  if (/Z$|[+-]\d\d:\d\d$/.test(s)) return dateToLocalNaive(new Date(s));
  return s; // allerede naiv lokal
}
export function minutesBetween(aNaive, bNaive) {
  const toMs = (s) => { const [d, t] = s.split("T"); const [y, m, dd] = d.split("-").map(Number); const [h, mi] = (t || "00:00").split(":").map(Number); return Date.UTC(y, m - 1, dd, h, mi); };
  return Math.round((toMs(bNaive) - toMs(aNaive)) / 60000);
}
export function timeAgo(naive) {
  const mins = minutesBetween(naive, nowLocal());
  if (mins < 2) return "lige nu";
  if (mins < 60) return `${mins} min. siden`;
  if (mins < 60 * 24) return `${Math.floor(mins / 60)} t. siden`;
  const days = Math.floor(mins / 1440);
  return days === 1 ? "i går" : `${days} dage siden`;
}

// ---- Flerdagsbookinger (samme logik som admin-kalenderen: src/lib/multiday.ts) ----
export function lastDay(b) {
  const sd = b.startsAt.slice(0, 10), ed = b.endsAt.slice(0, 10);
  if (ed > sd && b.endsAt.slice(11, 16) === "00:00") return addDaysStr(ed, -1);
  return ed < sd ? sd : ed;
}
export const isMultiDay = (b) => lastDay(b) > b.startsAt.slice(0, 10);
export const onDay = (b, day) => b.startsAt.slice(0, 10) <= day && day <= lastDay(b);
export function dayTimeLabel(b, day) {
  if (!isMultiDay(b)) return `${hhmm(b.startsAt)}–${hhmm(b.endsAt)}`;
  if (day === b.startsAt.slice(0, 10)) return `fra ${hhmm(b.startsAt)}`;
  if (day === lastDay(b) && b.endsAt.slice(0, 10) === day) return `til ${hhmm(b.endsAt)}`;
  return "hele dagen";
}
/** Slutter bookingen før klokken "now" (naiv)? */
export const isOver = (b, now = nowLocal()) => b.endsAt <= now;
export const isNow = (b, now = nowLocal()) => b.startsAt <= now && now < b.endsAt;

export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const INACTIVE = new Set(["aflyst", "afvist"]);
export const isCancelled = (b) => INACTIVE.has(b.status);
