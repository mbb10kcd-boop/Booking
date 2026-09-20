import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/db";
import { eq } from "drizzle-orm";
import { logAudit } from "@/lib/audit";
import { localISODate } from "@/lib/date";
import { seasonCancellationMessage } from "@/lib/ai/messages";
import { newId } from "@/lib/ids";

/**
 * Aflyser en HEL sæson på én gang - alle forekomster der ikke allerede er
 * overstået eller aflyst - i stedet for at skulle aflyse hver uges forekomst
 * for sig i kalenderen. Allerede overståede forekomster (før i dag) røres
 * ikke, så bookinghistorikken for sæsonen forbliver intakt.
 */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ seasonGroupId: string }> }) {
  const { seasonGroupId } = await params;
  const rows = await db.select().from(schema.bookings).where(eq(schema.bookings.seasonGroupId, seasonGroupId));
  if (rows.length === 0) return NextResponse.json({ error: "Ikke fundet" }, { status: 404 });

  const todayStr = localISODate();
  const toCancel = rows
    .filter((b) => b.status !== "aflyst" && b.startsAt.slice(0, 10) >= todayStr)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));

  for (const booking of toCancel) {
    await db.update(schema.bookings).set({ status: "aflyst" }).where(eq(schema.bookings.id, booking.id));
    await logAudit("booking", booking.id, "aflyst", "Aflyst som del af hele sæsonen");
  }

  // Én samlet aflysningsmail for hele sæsonen (ikke én pr. forekomst).
  const first = toCancel[0];
  if (first) {
    let recipient = first.contactEmail;
    if (!recipient && first.organizationId) {
      const [org] = await db.select().from(schema.organizations).where(eq(schema.organizations.id, first.organizationId));
      recipient = org?.contactEmail ?? null;
    }
    if (recipient) {
      const [facility] = await db.select().from(schema.facilities).where(eq(schema.facilities.id, first.facilityId));
      const weekday = first.recurrenceRule?.weekday ?? new Date(`${first.startsAt.slice(0, 10)}T00:00:00`).getDay();
      const message = seasonCancellationMessage({
        facilityName: facility?.name ?? "faciliteten",
        weekday,
        startTime: first.startsAt.slice(11, 16),
        endTime: first.endsAt.slice(11, 16),
        cancelledFrom: first.startsAt.slice(0, 10),
        recipientName: first.contactName ?? undefined,
      });
      await db.insert(schema.notificationLog).values({
        id: newId("notif"),
        bookingId: first.id,
        type: "aflysning",
        recipient,
        subject: "Aflysning af jeres sæsonbooking",
        body: message,
      });
    }
  }

  return NextResponse.json({ cancelledBookingIds: toCancel.map((b) => b.id) });
}
