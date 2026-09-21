import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/db";
import { eq } from "drizzle-orm";
import { newId } from "@/lib/ids";
import { logAudit } from "@/lib/audit";
import { maybeCreateAccessCode } from "@/lib/accessCodes";

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
  const [facility] = await db.select().from(schema.facilities).where(eq(schema.facilities.id, booking.facilityId));
  const allFacilities = await db.select().from(schema.facilities);

  // Betalte bookinger (i praksis kun badmintonbanerne) er altid
  // privatpersoner - foreninger kan ikke booke dem (se hiddenFromOrgPortal) -
  // så den eneste afgørende faktor her er om lokalet har en kodedør, jf.
  // src/lib/accessCodes.ts. Badmintonbanerne bruger Træningshallens dør.
  const code = await maybeCreateAccessCode({
    bookingId: booking.id,
    organizationId: booking.organizationId,
    facility,
    allFacilities,
    startsAt: booking.startsAt,
    endsAt: booking.endsAt,
  });

  await db.insert(schema.notificationLog).values({
    id: newId("notif"),
    bookingId: booking.id,
    type: "betalingskvittering",
    recipient: booking.contactEmail ?? "ukendt",
    subject: code ? "Betaling modtaget - din adgangskode" : "Betaling modtaget",
    body: code
      ? `Tak for din betaling. Din dørkode er ${code}, gyldig ${booking.startsAt} - ${booking.endsAt}.`
      : `Tak for din betaling.`,
  });

  await logAudit("booking", booking.id, "betalt", code ? `Adgangskode ${code} genereret` : undefined);

  return NextResponse.json({ booking, accessCode: code });
}
