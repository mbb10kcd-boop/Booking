import { db, schema } from "@/db";
import { and, eq, gt, inArray, sql } from "drizzle-orm";
import { newId } from "@/lib/ids";

/**
 * Winkas-log: kommunen opretter vores sæsonbookinger i Winkas, og Winkas er
 * facit for aktivitetstimerne. Indtil der evt. kommer en API, skal de
 * bookinger der oprettes/ændres/aflyses HER indtastes manuelt i Winkas. Denne
 * fil finder ud af hvad der er sket siden sidste log, og laver en CSV-fil
 * (åbner direkte i Excel).
 *
 * Bookinger der selv kom fra Winkas (mails fra kommunen = source "mail", og
 * sæsonimport = "saesonimport") er som standard IKKE med - de findes jo
 * allerede i Winkas.
 */

type Booking = typeof schema.bookings.$inferSelect;

const ACTIVE_STATUSES: Booking["status"][] = ["reserveret", "bekraeftet", "betalt"];
const INACTIVE_STATUSES = ["aflyst", "afvist"];
const WINKAS_SOURCES = ["mail", "saesonimport"];
const BASELINE_KEY = "winkas_baseline";

let ready: Promise<void> | null = null;
export function ensureWinkasTables(): Promise<void> {
  if (!ready) {
    ready = (async () => {
      await db.run(sql`CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL)`);
      await db.run(sql`CREATE TABLE IF NOT EXISTS winkas_sync (
        booking_id TEXT PRIMARY KEY NOT NULL,
        facility_id TEXT NOT NULL,
        starts_at TEXT NOT NULL,
        ends_at TEXT NOT NULL,
        export_id TEXT,
        exported_at TEXT
      )`);
      await db.run(sql`CREATE TABLE IF NOT EXISTS winkas_exports (
        id TEXT PRIMARY KEY NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        created_by TEXT,
        new_count INTEGER DEFAULT 0,
        moved_count INTEGER DEFAULT 0,
        cancelled_count INTEGER DEFAULT 0,
        csv TEXT NOT NULL
      )`);
    })().catch((err) => {
      ready = null;
      throw err;
    });
  }
  return ready;
}

/** UTC-tidsstempel i samme format som createdAt-kolonnerne ("YYYY-MM-DD HH:MM:SS"). */
export function utcStamp(d = new Date()): string {
  return d.toISOString().slice(0, 19).replace("T", " ");
}

export async function getBaseline(): Promise<string> {
  await ensureWinkasTables();
  const [row] = await db.select().from(schema.appSettings).where(eq(schema.appSettings.key, BASELINE_KEY));
  if (row) return row.value;
  const now = utcStamp();
  await db.insert(schema.appSettings).values({ key: BASELINE_KEY, value: now }).onConflictDoNothing();
  return now;
}

export async function setBaseline(utc: string): Promise<void> {
  await ensureWinkasTables();
  await db
    .insert(schema.appSettings)
    .values({ key: BASELINE_KEY, value: utc })
    .onConflictDoUpdate({ target: schema.appSettings.key, set: { value: utc } });
}

export type LogAction = "NY BOOKING" | "FLYTNING" | "AFLYSNING";

export interface LogRow {
  action: LogAction;
  facility: string;
  organization: string;
  title: string;
  weekday: string;
  fromTime: string;
  toTime: string;
  firstDate: string;
  lastDate: string;
  count: number;
  hours: number;
  dates: string[];
  previous: string;
  contact: string;
  source: string;
  note: string;
  bookingIds: string[];
}

export interface PendingLog {
  baseline: string;
  rows: LogRow[];
  counts: { new: number; moved: number; cancelled: number };
  /** Til markering efter download. */
  newBookings: Booking[];
  moved: { booking: Booking }[];
  cancelledIds: string[];
}

const WEEKDAYS = ["søndag", "mandag", "tirsdag", "onsdag", "torsdag", "fredag", "lørdag"];
const dk = (iso: string) => iso.split("-").reverse().join(".");
function parseNaive(s: string): number {
  const m = s.match(/(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return NaN;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
}
function hoursBetween(a: string, b: string): number {
  return Math.max(0, (parseNaive(b) - parseNaive(a)) / 3_600_000);
}
function weekdayOf(isoDate: string): string {
  return WEEKDAYS[new Date(`${isoDate}T12:00:00Z`).getUTCDay()];
}

const SOURCE_LABELS: Record<string, string> = {
  manuel: "Oprettet i kalenderen",
  portal: "Bestilt via portalen",
  pedel: "Pedel",
  aflysningsliste: "Aflysningsliste",
  mail: "Fra Winkas-mail",
  saesonimport: "Importeret",
};

interface Item {
  action: LogAction;
  booking: Booking;
  /** Tid/facilitet som Winkas kender (kun flytning og aflysning). */
  old?: { facilityId: string; startsAt: string; endsAt: string };
}

export async function getPendingLog(includeWinkasSources = false): Promise<PendingLog> {
  await ensureWinkasTables();
  const baseline = await getBaseline();

  const [facilities, organizations, synced] = await Promise.all([
    db.select().from(schema.facilities),
    db.select().from(schema.organizations),
    db.select().from(schema.winkasSync),
  ]);
  const fname = new Map(facilities.map((f) => [f.id, f.name]));
  const oname = new Map(organizations.map((o) => [o.id, o.name]));
  const syncedById = new Map(synced.map((s) => [s.bookingId, s]));

  const items: Item[] = [];
  const newBookings: Booking[] = [];
  const moved: { booking: Booking }[] = [];
  const cancelledIds: string[] = [];

  // NYE: oprettet efter startdatoen, aktive, ikke allerede trukket.
  const fresh = await db
    .select()
    .from(schema.bookings)
    .where(and(gt(schema.bookings.createdAt, baseline), inArray(schema.bookings.status, ACTIVE_STATUSES)));
  for (const b of fresh) {
    if (syncedById.has(b.id)) continue;
    if (!includeWinkasSources && WINKAS_SOURCES.includes(b.source ?? "manuel")) continue;
    newBookings.push(b);
    items.push({ action: "NY BOOKING", booking: b });
  }

  // FLYTTET / AFLYST: bookinger vi tidligere har trukket, hvis tid er ændret eller som er aflyst.
  const ids = synced.map((s) => s.bookingId);
  for (let i = 0; i < ids.length; i += 400) {
    const chunk = ids.slice(i, i + 400);
    const rows = await db.select().from(schema.bookings).where(inArray(schema.bookings.id, chunk));
    for (const b of rows) {
      const s = syncedById.get(b.id)!;
      const old = { facilityId: s.facilityId, startsAt: s.startsAt, endsAt: s.endsAt };
      if (INACTIVE_STATUSES.includes(b.status)) {
        cancelledIds.push(b.id);
        items.push({ action: "AFLYSNING", booking: b, old });
      } else if (b.facilityId !== s.facilityId || b.startsAt !== s.startsAt || b.endsAt !== s.endsAt) {
        moved.push({ booking: b });
        items.push({ action: "FLYTNING", booking: b, old });
      }
    }
    // Bookinger der er slettet helt fra databasen (findes ikke længere) behandles som aflyst.
    const found = new Set(rows.map((r) => r.id));
    for (const id of chunk) if (!found.has(id)) cancelledIds.push(id);
  }

  // Slå sæsonforekomster med samme tidspunkt sammen til én linje.
  const groups = new Map<string, Item[]>();
  for (const it of items) {
    const ref = it.old ?? it.booking;
    const fac = it.old?.facilityId ?? it.booking.facilityId;
    const key = it.booking.seasonGroupId
      ? [it.action, it.booking.seasonGroupId, fac, ref.startsAt.slice(11, 16), ref.endsAt.slice(11, 16)].join("|")
      : [it.action, it.booking.id].join("|");
    const g = groups.get(key) ?? [];
    g.push(it);
    groups.set(key, g);
  }

  const rows: LogRow[] = [];
  for (const g of groups.values()) {
    g.sort((a, b) => a.booking.startsAt.localeCompare(b.booking.startsAt));
    const first = g[0];
    const b = first.booking;
    const showStart = first.action === "AFLYSNING" && first.old ? first.old.startsAt : b.startsAt;
    const showEnd = first.action === "AFLYSNING" && first.old ? first.old.endsAt : b.endsAt;
    const facId = first.action === "AFLYSNING" && first.old ? first.old.facilityId : b.facilityId;
    const dates = g.map((x) => dk((x.action === "AFLYSNING" && x.old ? x.old.startsAt : x.booking.startsAt).slice(0, 10)));
    const hours = g.reduce(
      (sum, x) => sum + (x.action === "AFLYSNING" && x.old ? hoursBetween(x.old.startsAt, x.old.endsAt) : hoursBetween(x.booking.startsAt, x.booking.endsAt)),
      0
    );
    const multiDay = showStart.slice(0, 10) !== showEnd.slice(0, 10);
    const previous = first.old
      ? g
          .map((x) => `${fname.get(x.old!.facilityId) ?? "?"} ${dk(x.old!.startsAt.slice(0, 10))} ${x.old!.startsAt.slice(11, 16)}–${x.old!.endsAt.slice(11, 16)}`)
          .join("; ")
      : "";
    const notes: string[] = [];
    if (b.seasonGroupId && g.length > 1) notes.push("Sæsonbooking (gentages ugentligt)");
    if (multiDay) notes.push(`Løber til ${dk(showEnd.slice(0, 10))} kl. ${showEnd.slice(11, 16)}`);
    if (b.paymentStatus === "betalt" && (b.price ?? 0) > 0) notes.push(`Betalt ${Math.round(b.price ?? 0)} kr.`);
    if (b.important) notes.push("Vigtig/kamp");
    if (b.notes) notes.push(b.notes);
    rows.push({
      action: first.action,
      facility: fname.get(facId) ?? "?",
      organization: b.organizationId ? oname.get(b.organizationId) ?? "" : "",
      title: b.title ?? "",
      weekday: weekdayOf(showStart.slice(0, 10)),
      fromTime: showStart.slice(11, 16),
      toTime: showEnd.slice(11, 16),
      firstDate: dates[0],
      lastDate: dates[dates.length - 1],
      count: g.length,
      hours: Math.round(hours * 100) / 100,
      dates,
      previous,
      contact: [b.contactName, b.contactEmail, b.contactPhone].filter(Boolean).join(", "),
      source: SOURCE_LABELS[b.source ?? "manuel"] ?? (b.source ?? ""),
      note: notes.join(" · "),
      bookingIds: g.map((x) => x.booking.id),
    });
  }

  const order: Record<LogAction, number> = { "NY BOOKING": 0, FLYTNING: 1, AFLYSNING: 2 };
  const dsort = (d: string) => d.split(".").reverse().join("-");
  rows.sort(
    (a, b) =>
      order[a.action] - order[b.action] ||
      a.facility.localeCompare(b.facility, "da") ||
      dsort(a.firstDate).localeCompare(dsort(b.firstDate)) ||
      a.fromTime.localeCompare(b.fromTime)
  );

  return {
    baseline,
    rows,
    counts: { new: newBookings.length, moved: moved.length, cancelled: cancelledIds.length },
    newBookings,
    moved,
    cancelledIds,
  };
}

function csvCell(v: string | number): string {
  const s = String(v);
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function buildCsv(rows: LogRow[]): string {
  const header = [
    "Handling",
    "Facilitet",
    "Forening",
    "Titel",
    "Ugedag",
    "Fra kl.",
    "Til kl.",
    "Første dato",
    "Sidste dato",
    "Antal gange",
    "Timer i alt",
    "Alle datoer",
    "Tidligere (flytning/aflysning)",
    "Kontakt",
    "Kilde",
    "Bemærkning",
  ];
  const lines = [header.map(csvCell).join(";")];
  for (const r of rows) {
    lines.push(
      [
        r.action,
        r.facility,
        r.organization,
        r.title,
        r.weekday,
        r.fromTime,
        r.toTime,
        r.firstDate,
        r.lastDate,
        r.count,
        String(r.hours).replace(".", ","),
        r.dates.join(", "),
        r.previous,
        r.contact,
        r.source,
        r.note,
      ]
        .map(csvCell)
        .join(";")
    );
  }
  // BOM + semikolon: Excel på dansk åbner filen med æøå og kolonner korrekt.
  return "﻿" + lines.join("\r\n") + "\r\n";
}

/** Markerer alt i `pending` som trukket og gemmer CSV'en, så den kan hentes igen. */
export async function commitLog(pending: PendingLog, csv: string, createdBy: string): Promise<string> {
  const exportId = newId("wexp");
  const now = utcStamp();
  await db.insert(schema.winkasExports).values({
    id: exportId,
    createdAt: now,
    createdBy,
    newCount: pending.counts.new,
    movedCount: pending.counts.moved,
    cancelledCount: pending.counts.cancelled,
    csv,
  });
  for (const b of [...pending.newBookings, ...pending.moved.map((m) => m.booking)]) {
    await db
      .insert(schema.winkasSync)
      .values({ bookingId: b.id, facilityId: b.facilityId, startsAt: b.startsAt, endsAt: b.endsAt, exportId, exportedAt: now })
      .onConflictDoUpdate({
        target: schema.winkasSync.bookingId,
        set: { facilityId: b.facilityId, startsAt: b.startsAt, endsAt: b.endsAt, exportId, exportedAt: now },
      });
  }
  for (let i = 0; i < pending.cancelledIds.length; i += 400) {
    await db.delete(schema.winkasSync).where(inArray(schema.winkasSync.bookingId, pending.cancelledIds.slice(i, i + 400)));
  }
  return exportId;
}

export async function listExports() {
  await ensureWinkasTables();
  const rows = await db
    .select({
      id: schema.winkasExports.id,
      createdAt: schema.winkasExports.createdAt,
      createdBy: schema.winkasExports.createdBy,
      newCount: schema.winkasExports.newCount,
      movedCount: schema.winkasExports.movedCount,
      cancelledCount: schema.winkasExports.cancelledCount,
    })
    .from(schema.winkasExports);
  return rows.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? "")).slice(0, 30);
}

export async function getExportCsv(id: string): Promise<{ csv: string; createdAt: string | null } | null> {
  await ensureWinkasTables();
  const [row] = await db.select().from(schema.winkasExports).where(eq(schema.winkasExports.id, id));
  return row ? { csv: row.csv, createdAt: row.createdAt } : null;
}
