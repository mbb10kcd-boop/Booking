import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/db";
import { and, eq, gte, notInArray } from "drizzle-orm";
import { localISODate } from "@/lib/date";

/**
 * Foreningsportalen: en forenings KOMMENDE bookinger, til "anmod om aflysning"-
 * skærmen. Sæsonbookinger samles pr. serie (seasonGroupId), øvrige bookinger
 * vises enkeltvis. Kun tider/faciliteter - ingen kontaktoplysninger eller
 * noter. Kun for godkendte foreninger (som resten af foreningsportalen).
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [org] = await db.select().from(schema.organizations).where(eq(schema.organizations.id, id));
  if (!org || org.status !== "godkendt") {
    return NextResponse.json({ error: "Ikke fundet" }, { status: 404 });
  }

  const today = localISODate();
  const [rows, facilities] = await Promise.all([
    db
      .select()
      .from(schema.bookings)
      .where(
        and(
          eq(schema.bookings.organizationId, id),
          gte(schema.bookings.startsAt, `${today}T00:00:00`),
          notInArray(schema.bookings.status, ["aflyst", "afvist"])
        )
      ),
    db.select().from(schema.facilities),
  ]);
  const facilityName = new Map(facilities.map((f) => [f.id, f.name]));
  rows.sort((a, b) => a.startsAt.localeCompare(b.startsAt));

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

  const series = Array.from(seriesMap.entries()).map(([seasonGroupId, list]) => ({
    seasonGroupId,
    facilityName: facilityName.get(list[0].facilityId) ?? "Ukendt facilitet",
    weekday: new Date(`${list[0].startsAt.slice(0, 10)}T00:00:00`).getDay(),
    startTime: list[0].startsAt.slice(11, 16),
    endTime: list[0].endsAt.slice(11, 16),
    firstDate: list[0].startsAt.slice(0, 10),
    lastDate: list[list.length - 1].startsAt.slice(0, 10),
    dates: list.map((b) => b.startsAt.slice(0, 10)),
  }));
  series.sort((a, b) => a.firstDate.localeCompare(b.firstDate) || a.startTime.localeCompare(b.startTime));

  return NextResponse.json({
    series,
    singles: singles.map((b) => ({
      id: b.id,
      facilityName: facilityName.get(b.facilityId) ?? "Ukendt facilitet",
      date: b.startsAt.slice(0, 10),
      startTime: b.startsAt.slice(11, 16),
      endTime: b.endsAt.slice(11, 16),
    })),
  });
}
