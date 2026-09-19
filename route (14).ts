import { NextResponse } from "next/server";
import { db, schema } from "@/db";
import { localISODate, nowLocalDateTimeString } from "@/lib/date";

export async function GET() {
  const todayStr = localISODate();

  const allBookings = await db.select().from(schema.bookings);
  const todaysBookings = allBookings.filter(
    (b) => b.startsAt.slice(0, 10) === todayStr && b.status !== "aflyst" && b.status !== "afvist"
  );

  const facilities = await db.select().from(schema.facilities);
  const activeFacilities = new Set(todaysBookings.map((b) => b.facilityId)).size;

  const upcoming = allBookings.filter((b) => b.startsAt > nowLocalDateTimeString() && b.status !== "aflyst").length;

  const requests = await db.select().from(schema.bookingRequests);
  const newRequests = requests.filter((r) => r.status === "ny").length;

  const lines = await db.select().from(schema.bookingRequestLines);
  const conflicts = lines.filter((l) => l.status === "konflikt").length;

  const payments = await db.select().from(schema.payments);
  const missingPayments = payments.filter((p) => p.status === "afventer").length;

  return NextResponse.json({
    today: {
      bookingsCount: todaysBookings.length,
      activeFacilities,
      upcomingEvents: upcoming,
      newRequests,
      conflicts,
    },
    requiresAction: {
      newMails: newRequests,
      conflicts,
      pendingRequests: lines.filter((l) => l.status === "ledig").length,
      missingPayments,
    },
    facilityCount: facilities.filter((f) => !f.archived).length,
  });
}
