import { db, schema } from "@/db";
import { facilitiesConflict, facilitiesWarn, getAllFacilities } from "./facilities";
import { nowLocalDateTimeString } from "./date";

export type Booking = typeof schema.bookings.$inferSelect;

const INACTIVE_STATUSES = new Set(["aflyst", "afvist"]);

function overlaps(startA: string, endA: string, startB: string, endB: string): boolean {
  return startA < endB && startB < endA;
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

  const all = await db.select().from(schema.bookings);
  const allActive = all.filter(
    (b) => !INACTIVE_STATUSES.has(b.status) && (!excludeBookingId || b.id !== excludeBookingId)
  );

  return allActive.filter((b) => {
    if (!overlaps(startsAt, endsAt, b.startsAt, b.endsAt)) return false;
    return facilitiesConflict(facilityId, b.facilityId, facilities);
  });
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

  const all = await db.select().from(schema.bookings);
  const allActive = all.filter(
    (b) => !INACTIVE_STATUSES.has(b.status) && (!excludeBookingId || b.id !== excludeBookingId)
  );

  return allActive.filter((b) => {
    if (!overlaps(startsAt, endsAt, b.startsAt, b.endsAt)) return false;
    return facilitiesWarn(facilityId, b.facilityId, facilities);
  });
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
