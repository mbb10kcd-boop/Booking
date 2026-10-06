import { db, schema } from "@/db";
import { and, eq, gte, isNotNull, notInArray, or } from "drizzle-orm";
import { localISODate } from "@/lib/date";

export type CancelListRow = {
  id: string;
  date: string; // YYYY-MM-DD (den oprindelige/aflyste tid)
  startTime: string;
  endTime: string;
  hall: string; // øverste facilitet (fx Træningshallen)
  facility: string; // den konkrete facilitet
  who: string | null; // forening (null for poster lagt direkte på listen)
  reason: string | null;
  movedTo: string | null; // sat = "flyttet til ..." i stedet for aflyst
};

const fmtT = (t: string) => t.replace(":", ".");

/**
 * Aflysningslisten til hjemmesiden: KOMMENDE aflyste (cancelledAt er sat =
 * rigtig aflysning, ikke stille oprydning) og FLYTTEDE (movedFrom* er sat)
 * foreningsbookinger, kronologisk efter den oprindelige tid. Kun
 * foreningsbookinger - privatpersoners baner vises ikke. Kun offentlige
 * oplysninger: tid, hal, forening, evt. årsag og hvortil en booking er flyttet.
 */
export async function loadCancelList(): Promise<CancelListRow[]> {
  const today = localISODate();
  const from = `${today}T00:00:00`;
  const [cancelled, moved, facilities, orgs] = await Promise.all([
    db
      .select()
      .from(schema.bookings)
      .where(
        and(
          eq(schema.bookings.status, "aflyst"),
          isNotNull(schema.bookings.cancelledAt),
          // Foreningsbookinger - eller poster lagt direkte på listen (source
          // "aflysningsliste", fx en begivenhed der optager hallen).
          or(isNotNull(schema.bookings.organizationId), eq(schema.bookings.source, "aflysningsliste")),
          gte(schema.bookings.startsAt, from)
        )
      ),
    db
      .select()
      .from(schema.bookings)
      .where(
        and(
          isNotNull(schema.bookings.movedFromStartsAt),
          isNotNull(schema.bookings.organizationId),
          notInArray(schema.bookings.status, ["aflyst", "afvist"]),
          gte(schema.bookings.movedFromStartsAt, from)
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

  const result: CancelListRow[] = cancelled.map((b) => ({
    id: b.id,
    date: b.startsAt.slice(0, 10),
    startTime: b.startsAt.slice(11, 16),
    endTime: b.endsAt.slice(11, 16),
    hall: root(b.facilityId)?.name ?? "Ukendt",
    facility: facById.get(b.facilityId)?.name ?? "Ukendt",
    who: b.organizationId ? orgName.get(b.organizationId) ?? b.title : null,
    reason: b.cancelReason?.trim() || null,
    movedTo: null,
  }));

  for (const b of moved) {
    const fromFacilityId = b.movedFromFacilityId ?? b.facilityId;
    const fromStart = b.movedFromStartsAt!;
    const fromEnd = b.movedFromEndsAt ?? b.endsAt;
    const parts: string[] = [];
    if (fromFacilityId !== b.facilityId) parts.push(facById.get(b.facilityId)?.name ?? "anden facilitet");
    if (fromStart.slice(0, 10) !== b.startsAt.slice(0, 10)) {
      const [, m, d] = b.startsAt.slice(0, 10).split("-").map(Number);
      parts.push(`${d}/${m}`);
    }
    if (fromStart.slice(11, 16) !== b.startsAt.slice(11, 16) || fromEnd.slice(11, 16) !== b.endsAt.slice(11, 16)) {
      parts.push(`kl. ${fmtT(b.startsAt.slice(11, 16))}-${fmtT(b.endsAt.slice(11, 16))}`);
    }
    result.push({
      id: `moved_${b.id}`,
      date: fromStart.slice(0, 10),
      startTime: fromStart.slice(11, 16),
      endTime: fromEnd.slice(11, 16),
      hall: root(fromFacilityId)?.name ?? "Ukendt",
      facility: facById.get(fromFacilityId)?.name ?? "Ukendt",
      who: orgName.get(b.organizationId!) ?? b.title,
      reason: null,
      movedTo: parts.join(", ") || "anden tid",
    });
  }

  result.sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime) || a.facility.localeCompare(b.facility));
  return result;
}
