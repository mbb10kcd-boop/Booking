import { db, schema } from "@/db";
import { and, eq, gte, isNotNull } from "drizzle-orm";
import { localISODate } from "@/lib/date";

export type CancelListRow = {
  id: string;
  date: string; // YYYY-MM-DD
  startTime: string;
  endTime: string;
  hall: string; // øverste facilitet (fx Træningshallen)
  facility: string; // den konkrete facilitet
  who: string; // forening
  reason: string | null;
};

/**
 * Aflysningslisten til hjemmesiden: KOMMENDE aflyste foreningsbookinger
 * (cancelledAt er sat = rigtig aflysning, ikke stille oprydning), kronologisk.
 * Kun foreningsbookinger - aflysninger af privatpersoners baner vises ikke.
 * Kun offentlige oplysninger: tid, hal, forening og en evt. årsag.
 */
export async function loadCancelList(): Promise<CancelListRow[]> {
  const today = localISODate();
  const [rows, facilities, orgs] = await Promise.all([
    db
      .select()
      .from(schema.bookings)
      .where(
        and(
          eq(schema.bookings.status, "aflyst"),
          isNotNull(schema.bookings.cancelledAt),
          isNotNull(schema.bookings.organizationId),
          gte(schema.bookings.startsAt, `${today}T00:00:00`)
        )
      ),
    db.select().from(schema.facilities),
    db.select().from(schema.organizations),
  ]);
  const facById = new Map(facilities.map((f) => [f.id, f]));
  const orgName = new Map(orgs.map((o) => [o.id, o.name]));
  const root = (id: string) => {
    let f = facById.get(id);
    for (let i = 0; i < 5 && f?.parentId && facById.get(f.parentId); i++) f = facById.get(f.parentId);
    return f;
  };
  const result: CancelListRow[] = rows.map((b) => ({
    id: b.id,
    date: b.startsAt.slice(0, 10),
    startTime: b.startsAt.slice(11, 16),
    endTime: b.endsAt.slice(11, 16),
    hall: root(b.facilityId)?.name ?? "Ukendt",
    facility: facById.get(b.facilityId)?.name ?? "Ukendt",
    who: orgName.get(b.organizationId!) ?? b.title,
    reason: b.cancelReason?.trim() || null,
  }));
  result.sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime) || a.facility.localeCompare(b.facility));
  return result;
}
