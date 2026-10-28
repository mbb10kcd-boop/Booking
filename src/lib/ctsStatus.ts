/**
 * Lysstyring (CTS): beregner for hver lyszone (= hver topniveau-hal/lokale) om
 * lyset skal være TÆNDT eller SLUKKET lige nu. Al logik ligger her i
 * bookingsystemet, så CTS-siden (MikroTik KNOT -> Trend) kun skal læse ON/OFF:
 *
 *  - Alle aktive bookinger tæller (foreninger og private) - aflyste/afviste og
 *    endnu ikke godkendte (forespørgsel, afventer godkendelse, midlertidig) gør ikke.
 *  - Underfaciliteter (badmintonbaner, klatrevæg) tænder lyset i deres hal.
 *  - Hver booking udvides med tid FØR (lead) og EFTER (lag), og vinduer der
 *    overlapper eller rører hinanden slås sammen - så lyset ikke slukker og
 *    tænder igen mellem to bookinger lige efter hinanden.
 *
 * Alle tider er "naive" lokale strenge (Europe/Copenhagen), samme format som
 * bookingerne i databasen.
 */
import type { Booking } from "@/lib/conflicts";
import { normalizeLightLevel } from "@/lib/lightLevels";

export interface CtsFacility {
  id: string;
  name: string;
  parentId: string | null;
  archived?: boolean | null;
}

export interface CtsWindow {
  from: string; // naiv lokal "YYYY-MM-DDTHH:mm:ss" (inkl. tid før)
  until: string; // inkl. tid efter
  /** Højeste lysniveau (lux) blandt bookingerne i vinduet. */
  lux: number;
}

export interface CtsZoneStatus {
  id: string;
  name: string;
  light: "ON" | "OFF";
  on: boolean;
  /** Lysniveau lige nu i lux: 0 (slukket), 400, 700 eller 1000. Ved overlap vinder det højeste. */
  lux: number;
  /** Hvis ON: vinduet vi er i lige nu. */
  current: CtsWindow | null;
  /** Næste vindue der starter senere (hvis ON, efter det nuværende). */
  next: CtsWindow | null;
  /** Navne på de faciliteter, der tænder lyset i zonen. */
  includes: string[];
}

/** Statusser der IKKE tænder lyset (booking ikke endelig endnu / ikke længere gældende). */
export const DEFAULT_EXCLUDED_STATUSES = ["aflyst", "afvist", "forespoergsel", "afventer_godkendelse", "midlertidig"];

export function zoneIdFromName(name: string): string {
  return name
    .toLowerCase()
    .replace(/æ/g, "ae")
    .replace(/ø/g, "oe")
    .replace(/å/g, "aa")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Naiv lokal streng -> minutter siden 1970 (rent regnestykke, ingen tidszone/sommertid). */
function toMin(naive: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(naive);
  if (!m) return NaN;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) / 60000;
}

function fromMin(min: number): string {
  const d = new Date(min * 60000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:00`;
}

/** Topniveau-faciliteten (zonen) en facilitet hører under. */
function rootOf(f: CtsFacility, byId: Map<string, CtsFacility>): CtsFacility {
  let cur = f;
  for (let i = 0; i < 10 && cur.parentId && byId.get(cur.parentId); i++) cur = byId.get(cur.parentId)!;
  return cur;
}

export function computeCtsStatus(opts: {
  facilities: CtsFacility[];
  bookings: Pick<Booking, "facilityId" | "startsAt" | "endsAt" | "status" | "lightLevel">[];
  nowNaive: string;
  leadMinutes: number;
  lagMinutes: number;
  excludedStatuses?: string[];
}): CtsZoneStatus[] {
  const excluded = new Set(opts.excludedStatuses ?? DEFAULT_EXCLUDED_STATUSES);
  const byId = new Map(opts.facilities.map((f) => [f.id, f]));
  const now = toMin(opts.nowNaive);
  const zones = opts.facilities.filter((f) => !f.parentId && !f.archived);

  const zoneWindows = new Map<string, [number, number, number][]>(); // [fra, til, lux]
  const zoneIncludes = new Map<string, Set<string>>();
  for (const z of zones) {
    zoneWindows.set(z.id, []);
    zoneIncludes.set(z.id, new Set([z.name]));
  }
  for (const b of opts.bookings) {
    if (excluded.has(b.status)) continue;
    const f = byId.get(b.facilityId);
    if (!f) continue;
    const root = rootOf(f, byId);
    const list = zoneWindows.get(root.id);
    if (!list) continue; // arkiveret zone
    const s = toMin(b.startsAt);
    const e = toMin(b.endsAt);
    if (Number.isNaN(s) || Number.isNaN(e) || e <= s) continue;
    list.push([s - opts.leadMinutes, e + opts.lagMinutes, normalizeLightLevel(b.lightLevel)]);
    zoneIncludes.get(root.id)!.add(f.name);
  }

  return zones.map((z) => {
    const sorted = (zoneWindows.get(z.id) ?? []).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    // Sammenflettede vinduer; lux = højeste niveau blandt bookingerne i vinduet.
    const merged: [number, number, number][] = [];
    for (const w of sorted) {
      const last = merged[merged.length - 1];
      if (last && w[0] <= last[1]) {
        last[1] = Math.max(last[1], w[1]);
        last[2] = Math.max(last[2], w[2]);
      } else merged.push([w[0], w[1], w[2]]);
    }
    const cur = merged.find(([s, e]) => s <= now && now < e) ?? null;
    const next = merged.find(([s]) => s > now) ?? null;
    // Lysniveau lige nu: højeste niveau blandt de bookinger (inkl. tid før/efter), der dækker nu-tidspunktet.
    const luxNow = sorted.filter(([s, e]) => s <= now && now < e).reduce((m, w) => Math.max(m, w[2]), 0);
    const win = (w: [number, number, number] | null): CtsWindow | null =>
      w ? { from: fromMin(w[0]), until: fromMin(w[1]), lux: w[2] } : null;
    return {
      id: zoneIdFromName(z.name),
      name: z.name,
      light: cur ? "ON" : "OFF",
      on: !!cur,
      lux: cur ? luxNow : 0,
      current: win(cur),
      next: win(next),
      includes: Array.from(zoneIncludes.get(z.id) ?? []),
    };
  });
}
