import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/db";
import { eq } from "drizzle-orm";
import { localISODate } from "@/lib/date";

/** Returnerer dagens program for en given infoskærm, klar til visning */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [screen] = await db.select().from(schema.infoScreens).where(eq(schema.infoScreens.id, id));
  if (!screen) return NextResponse.json({ error: "Skærm ikke fundet" }, { status: 404 });

  const facilities = await db.select().from(schema.facilities);
  const relevantFacilityIds = screen.facilityIds && screen.facilityIds.length > 0
    ? screen.facilityIds
    : facilities.map((f) => f.id);

  const todayStr = localISODate();
  const allBookings = await db.select().from(schema.bookings);
  const todaysBookings = allBookings
    .filter(
      (b) =>
        relevantFacilityIds.includes(b.facilityId) &&
        b.startsAt.slice(0, 10) === todayStr &&
        b.status !== "aflyst" &&
        b.status !== "afvist"
    )
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));

  const byFacility = relevantFacilityIds.map((fid) => ({
    facility: facilities.find((f) => f.id === fid),
    bookings: todaysBookings.filter((b) => b.facilityId === fid),
  }));

  return NextResponse.json({ screen, byFacility, generatedAt: new Date().toISOString() });
}
