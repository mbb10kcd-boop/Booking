import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/db";
import { and, eq, gte, notInArray } from "drizzle-orm";
import { localISODate } from "@/lib/date";

/**
 * Foreningsportalen: oversigt over en forenings KOMMENDE bookinger ("Mine
 * bookinger"), inkl. aflyste tider (markeret med cancelled: true), så
 * foreningen kan se hvad der er aflyst. Sæsonbookinger samles pr. serie
 * (seasonGroupId), øvrige bookinger vises enkeltvis. Hver forekomst har id,
 * dato, VIGTIG/KAMP-markering og om der ligger en afventende anmodning om
 * aflysning. Kun tider/faciliteter - ingen kontaktoplysninger eller noter.
 * Kun for godkendte foreninger (som resten af foreningsportalen).
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [org] = await db.select().from(schema.organizations).where(eq(schema.organizations.id, id));
  if (!org || org.status !== "godkendt") {
    return NextResponse.json({ error: "Ikke fundet" }, { status: 404 });
  }

  const today = localISODate();
  const [rows, facilities, pendingRequests] = await Promise.all([
    db
      .select()
      .from(schema.bookings)
      .where(
        and(
          eq(schema.bookings.organizationId, id),
          gte(schema.bookings.startsAt, `${today}T00:00:00`),
          notInArray(schema.bookings.status, ["afvist"])
        )
      ),
    db.select().from(schema.facilities),
    db
      .select()
      .from(schema.rescheduleRequests)
      .where(and(eq(schema.rescheduleRequests.organizationId, id), eq(schema.rescheduleRequests.status, "afventer"))),
  ]);
  const facilityName = new Map(facilities.map((f) => [f.id, f.name]));
  const pendingCancelIds = new Set<string>();
  for (const r of pendingRequests) {
    if (r.kind === "aflysning") r.conflictingBookingIds.forEach((bid) => pendingCancelIds.add(bid));
  }
  rows.sort((a, b) => a.startsAt.localeCompare(b.startsAt));

  const occurrence = (b: (typeof rows)[number]) => ({
    id: b.id,
    date: b.startsAt.slice(0, 10),
    cancelled: b.status === "aflyst",
    important: !!b.important,
    pendingCancel: pendingCancelIds.has(b.id),
  });

  const seriesMap = new Map<string, typeof rows>();
  const singles: typeof rows = [];
  for (const b of rows) {
    if (b.seasonGroupId) {
      const list = seriesMap.get(b.seasonGroupId) ?? [];
      list.push(b);
      seriesMap.set(b.seasonGroupId, list);
    } else {
      singles.push(b);
    }
  }

  const series = Array.from(seriesMap.entries()).map(([seasonGroupId, list]) => {
    const items = list.map(occurrence);
    return {
      seasonGroupId,
      facilityName: facilityName.get(list[0].facilityId) ?? "Ukendt facilitet",
      weekday: new Date(`${list[0].startsAt.slice(0, 10)}T00:00:00`).getDay(),
      startTime: list[0].startsAt.slice(11, 16),
      endTime: list[0].endsAt.slice(11, 16),
      firstDate: items[0].date,
      lastDate: items[items.length - 1].date,
      items,
      // De datoer der stadig kan aflyses (til anmod-om-aflysning).
      dates: items.filter((i) => !i.cancelled).map((i) => i.date),
    };
  });
  series.sort((a, b) => a.firstDate.localeCompare(b.firstDate) || a.startTime.localeCompare(b.startTime));

  return NextResponse.json({
    series,
    singles: singles.map((b) => ({
      ...occurrence(b),
      facilityName: facilityName.get(b.facilityId) ?? "Ukendt facilitet",
      startTime: b.startsAt.slice(11, 16),
      endTime: b.endsAt.slice(11, 16),
    })),
  });
}
