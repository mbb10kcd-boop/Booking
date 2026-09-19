import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/db";
import { eq } from "drizzle-orm";
import { newId } from "@/lib/ids";
import { logAudit } from "@/lib/audit";

/**
 * Simulerer en vellykket betaling (der findes endnu ikke en rigtig
 * betalingsudbyder-integration - se ARKITEKTUR.md for hvordan en rigtig
 * udbyder kobles på dette endpoint i stedet).
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ paymentId: string }> }) {
  const { paymentId } = await params;
  const [payment] = await db.select().from(schema.payments).where(eq(schema.payments.id, paymentId));
  if (!payment) return NextResponse.json({ error: "Betaling ikke fundet" }, { status: 404 });

  await db.update(schema.payments).set({ status: "betalt" }).where(eq(schema.payments.id, paymentId));
  await db
    .update(schema.bookings)
    .set({ status: "betalt", paymentStatus: "betalt" })
    .where(eq(schema.bookings.id, payment.bookingId));

  const [booking] = await db.select().from(schema.bookings).where(eq(schema.bookings.id, payment.bookingId));
  const code = String(Math.floor(1000 + Math.random() * 9000));
  await db.insert(schema.accessCodes).values({
    id: newId("code"),
    bookingId: booking.id,
    facilityId: booking.facilityId,
    code,
    validFrom: booking.startsAt,
    validTo: booking.endsAt,
    active: true,
    usageLog: [{ at: new Date().toISOString(), event: "genereret" }],
  });
  await db.update(schema.bookings).set({ accessCode: code }).where(eq(schema.bookings.id, booking.id));

  await db.insert(schema.notificationLog).values({
    id: newId("notif"),
    bookingId: booking.id,
    type: "betalingskvittering",
    recipient: booking.contactEmail ?? "ukendt",
    subject: "Betaling modtaget - din adgangskode",
    body: `Tak for din betaling. Din dørkode er ${code}, gyldig ${booking.startsAt} - ${booking.endsAt}.`,
  });

  await logAudit("booking", booking.id, "betalt", `Adgangskode ${code} genereret`);

  return NextResponse.json({ booking, accessCode: code });
}
