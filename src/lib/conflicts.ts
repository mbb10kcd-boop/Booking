import { db, schema } from "@/db";
import { and, gt, inArray, lt, notInArray } from "drizzle-orm";
import { facilitiesConflict, facilitiesWarn, getAllFacilities, type Facility } from "./facilities";
import { nowLocalDateTimeString } from "./date";

export type Booking = typeof schema.bookings.$inferSelect;

const INACTIVE_STATUSES = new Set(["aflyst", "afvist"]);

function overlaps(startA: string, endA: string, startB: string, endB: string): boolean {
  return startA < endB && startB < endA;
}

/**
 * Henter KUN de aktive bookinger der overlapper [from, to) og ligger på en af
 * de angivne faciliteter - filtreret i databasen. (Tidligere hentes ALLE
 * bookinger og filtreres i JavaScript, hvilket blev langsomt, da databasen
 * ligger på nettet og bookingerne nu tæller over tusind rækker - og et
 * sæsonbooking-tjek gjorde det én gang pr. uge.)
 */
export async function loadActiveBookingsBetween(from: string, to: string, facilityIds?: string[]): Promise<Booking[]> {
  if (facilityIds && facilityIds.length === 0) return [];
  return db
    .select()
    .from(schema.bookings)
    .where(
      and(
        lt(schema.bookings.startsAt, to),
        gt(schema.bookings.endsAt, from),
        notInArray(schema.bookings.status, ["aflyst", "afvist"]),
        facilityIds ? inArray(schema.bookings.facilityId, facilityIds) : undefined
      )
    );
}

/** Id'er på alle faciliteter der kan konflikte med ELLER give en bemærkning for `facilityId` (inkl. sig selv). */
export function relatedFacilityIds(facilityId: string, facilities: Facility[]): string[] {
  return facilities
    .filter((f) => facilitiesConflict(facilityId, f.id, facilities) || facilitiesWarn(facilityId, f.id, facilities))
    .map((f) => f.id);
}

/** Ren funktion: konflikter blandt allerede indlæste bookinger. */
export function conflictsAmong(
  rows: Booking[],
  facilities: Facility[],
  facilityId: string,
  startsAt: string,
  endsAt: string,
  excludeBookingId?: string
): Booking[] {
  return rows.filter(
    (b) =>
      !INACTIVE_STATUSES.has(b.status) &&
      (!excludeBookingId || b.id !== excludeBookingId) &&
      overlaps(startsAt, endsAt, b.startsAt, b.endsAt) &&
      facilitiesConflict(facilityId, b.facilityId, facilities)
  );
}

/** Ren funktion: bemærkninger (løst koblede faciliteter) blandt allerede indlæste bookinger. */
export function warningsAmong(
  rows: Booking[],
  facilities: Facility[],
  facilityId: string,
  startsAt: string,
  endsAt: string,
  excludeBookingId?: string
): Booking[] {
  return rows.filter(
    (b) =>
      !INACTIVE_STATUSES.has(b.status) &&
      (!excludeBookingId || b.id !== excludeBookingId) &&
      overlaps(startsAt, endsAt, b.startsAt, b.endsAt) &&
      facilitiesWarn(facilityId, b.facilityId, facilities)
  );
}

/**
 * Finder eksisterende bookinger der konflikter med et ønsket tidsrum på en facilitet
 * (tager højde for hal/underhal-hierarkiet).
 */
export async function findConflicts(
  facilityId: string,
  startsAt: string,
  endsAt: string,
  excludeBookingId?: string
): Promise<Booking[]> {
  const facilities = await getAllFacilities();
  const rows = await loadActiveBookingsBetween(startsAt, endsAt, relatedFacilityIds(facilityId, facilities));
  return conflictsAmong(rows, facilities, facilityId, startsAt, endsAt, excludeBookingId);
}

/**
 * Finder eksisterende bookinger på en LØST koblet facilitet (fx en klatrevæg
 * under opvisningshallen, se `conflictMode` i src/db/schema.ts) der
 * overlapper det ønskede tidsrum. Disse blokerer IKKE bookingen - kaldes
 * separat fra `findConflicts`, så resultatet kan vises som en bemærkning i
 * stedet for en konflikt.
 */
export async function findWarnings(
  facilityId: string,
  startsAt: string,
  endsAt: string,
  excludeBookingId?: string
): Promise<Booking[]> {
  const facilities = await getAllFacilities();
  const rows = await loadActiveBookingsBetween(startsAt, endsAt, relatedFacilityIds(facilityId, facilities));
  return warningsAmong(rows, facilities, facilityId, startsAt, endsAt, excludeBookingId);
}

export async function hasConflict(
  facilityId: string,
  startsAt: string,
  endsAt: string,
  excludeBookingId?: string
): Promise<boolean> {
  const conflicts = await findConflicts(facilityId, startsAt, endsAt, excludeBookingId);
  return conflicts.length > 0;
}

/** Foreslår alternative tidspunkter samme dag, samme facilitet, samme varighed */
export async function suggestAlternativeTimes(
  facilityId: string,
  startsAt: string,
  endsAt: string
): Promise<{ startsAt: string; endsAt: string }[]> {
  const durationMs = new Date(endsAt).getTime() - new Date(startsAt).getTime();
  const dayStart = new Date(startsAt);
  dayStart.setHours(7, 0, 0, 0);
  const dayEnd = new Date(startsAt);
  dayEnd.setHours(23, 0, 0, 0);

  const suggestions: { startsAt: string; endsAt: string }[] = [];
  let cursor = new Date(dayStart);
  while (cursor.getTime() + durationMs <= dayEnd.getTime() && suggestions.length < 3) {
    const candidateStart = new Date(cursor);
    const candidateEnd = new Date(cursor.getTime() + durationMs);
    const candidateStartStr = nowLocalDateTimeString(candidateStart);
    const candidateEndStr = nowLocalDateTimeString(candidateEnd);
    const conflicts = await findConflicts(facilityId, candidateStartStr, candidateEndStr);
    if (conflicts.length === 0) {
      suggestions.push({
        startsAt: candidateStartStr,
        endsAt: candidateEndStr,
      });
    }
    cursor = new Date(cursor.getTime() + 30 * 60 * 1000); // ryk 30 min frem
  }
  return suggestions;
}

/** Foreslår andre ledige faciliteter i samme tidsrum */
export async function suggestAlternativeFacilities(
  excludeFacilityId: string,
  startsAt: string,
  endsAt: string
): Promise<string[]> {
  const facilities = await getAllFacilities();
  const candidates = facilities.filter(
    (f) => f.id !== excludeFacilityId && !f.archived && !f.parentId // kun topniveau-faciliteter som forslag
  );
  const free: string[] = [];
  for (const f of candidates) {
    const conflicts = await findConflicts(f.id, startsAt, endsAt);
    if (conflicts.length === 0) free.push(f.id);
  }
  return free;
}

/**
 * Blandt en gruppe af INDBYRDES OMBYTTELIGE faciliteter (fx de 6 pickleball-
 * /badmintonbaner, se bookableGroupLabel i src/db/schema.ts), find hvilke af
 * dem der er ledige i det ønskede tidsrum. Bruges både til selve
 * ledighedstjekket og til at afgøre HVILKE konkrete bane-id'er en bestilling
 * på "N baner" rent faktisk skal tildeles.
 */
export async function findAvailableInGroup(
  facilityIds: string[],
  startsAt: string,
  endsAt: string
): Promise<string[]> {
  const free: string[] = [];
  for (const facilityId of facilityIds) {
    // eslint-disable-next-line no-await-in-loop
    const conflicts = await findConflicts(facilityId, startsAt, endsAt);
    if (conflicts.length === 0) free.push(facilityId);
  }
  return free;
}

/**
 * Ligesom suggestAlternativeTimes, men for en GRUPPE af ombyttelige
 * faciliteter: foreslår tidspunkter samme dag, hvor mindst `count` af dem er
 * ledige samtidig (samme varighed som det oprindeligt ønskede tidsrum).
 */
export async function suggestAlternativeGroupTimes(
  facilityIds: string[],
  startsAt: string,
  endsAt: string,
  count: number
): Promise<{ startsAt: string; endsAt: string }[]> {
  const durationMs = new Date(endsAt).getTime() - new Date(startsAt).getTime();
  const dayStart = new Date(startsAt);
  dayStart.setHours(7, 0, 0, 0);
  const dayEnd = new Date(startsAt);
  dayEnd.setHours(23, 0, 0, 0);

  const suggestions: { startsAt: string; endsAt: string }[] = [];
  let cursor = new Date(dayStart);
  while (cursor.getTime() + durationMs <= dayEnd.getTime() && suggestions.length < 3) {
    const candidateStart = new Date(cursor);
    const candidateEnd = new Date(cursor.getTime() + durationMs);
    const candidateStartStr = nowLocalDateTimeString(candidateStart);
    const candidateEndStr = nowLocalDateTimeString(candidateEnd);
    // eslint-disable-next-line no-await-in-loop
    const free = await findAvailableInGroup(facilityIds, candidateStartStr, candidateEndStr);
    if (free.length >= count) {
      suggestions.push({ startsAt: candidateStartStr, endsAt: candidateEndStr });
    }
    cursor = new Date(cursor.getTime() + 30 * 60 * 1000); // ryk 30 min frem
  }
  return suggestions;
}
