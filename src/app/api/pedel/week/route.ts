import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/db";
import { and, gte, lte, notInArray } from "drizzle-orm";
import { addDays, localISODate, startOfWeek } from "@/lib/date";
import { bookingOnDay } from "@/lib/multiday";

/**
 * Pedelvisningens ugeprogram: ?start=YYYY-MM-DD angiver en vilkårlig dato i
 * den ønskede uge (typisk mandagen, men vi regner selv den rigtige mandag ud
 * via startOfWeek, så et forkert/ugyldigt tal ikke vælter visningen).
 * Uden `start` vises indeværende uge.
 *
 * `start` parses bevidst som "YYYY-MM-DDT00:00:00" (med T, uden "Z") - IKKE
 * som bar "YYYY-MM-DD", som JS ellers fortolker som UTC-midnat og dermed kan
 * forskyde datoen en dag i visse tidszoner. Se kommentaren øverst i denne fil
 * og i src/lib/date.ts om altid at bruge naive lokale tidspunkter.
 */
export async function GET(req: NextRequest) {
  const startParam = req.nextUrl.searchParams.get("start");
  const requested = startParam ? new Date(`${startParam}T00:00:00`) : new Date();
  const weekStart = startOfWeek(Number.isNaN(requested.getTime()) ? new Date() : requested);
  const weekStartStr = localISODate(weekStart);
  const weekEndStr = localISODate(addDays(weekStart, 6));

  const facilities = await db.select().from(schema.facilities);
  // Bookinger der optager mindst én dag i ugen (også flerdagsbookinger der starter før ugen).
  const bookings = await db
    .select()
    .from(schema.bookings)
    .where(
      and(
        gte(schema.bookings.endsAt, `${weekStartStr}T00:00:00`),
        lte(schema.bookings.startsAt, `${weekEndStr}T23:59:59`),
        notInArray(schema.bookings.status, ["aflyst", "afvist"])
      )
    );
  const orgs = await db.select().from(schema.organizations);
  const notes = await db.select().from(schema.dayNotes);

  const weekBookings = bookings
    .filter((b) => Array.from({ length: 7 }, (_, i) => localISODate(addDays(weekStart, i))).some((d) => bookingOnDay(b, d)))
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
    .map((b) => ({
      ...b,
      facilityName: facilities.find((f) => f.id === b.facilityId)?.name ?? "Ukendt facilitet",
      organizationName: orgs.find((o) => o.id === b.organizationId)?.name,
    }));

  // Dagsnoter for ugen (fx "tekniker kommer til ventilationen") - så
  // pedellerne ser dem på pedelvisningen uden at det er en decideret booking.
  const weekDayNotes = notes
    .filter((n) => n.date >= weekStartStr && n.date <= weekEndStr)
    .sort((a, b) => a.date.localeCompare(b.date) || (a.createdAt ?? "").localeCompare(b.createdAt ?? ""));

  return NextResponse.json({ weekStart: weekStartStr, bookings: weekBookings, dayNotes: weekDayNotes });
}
