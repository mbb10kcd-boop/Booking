import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/db";
import { eq, inArray } from "drizzle-orm";
import { newId } from "@/lib/ids";
import { logAudit } from "@/lib/audit";
import { maybeCreateAccessCode } from "@/lib/accessCodes";

/**
 * Simulerer en vellykket betaling (der findes endnu ikke en rigtig
 * betalingsudbyder-integration - se ARKITEKTUR.md for hvordan en rigtig
 * udbyder kobles på dette endpoint i stedet).
 *
 * Dækker BÅDE en almindelig enkelt-facilitet-booking (/api/portal/book) og
 * en bestilling af flere baner på én gang (/api/portal/book-group, som
 * peger betalingen på den FØRSTE booking i gruppen, jf. schema.ts) - i
 * sidstnævnte tilfælde skal ALLE bookinger i samme multiBookingGroupId
 * bekræftes og have samme adgangskode, ikke kun den ene betalingen peger på.
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ paymentId: string }> }) {
  const { paymentId } = await params;
  const [payment] = await db.select().from(schema.payments).where(eq(schema.payments.id, paymentId));
  if (!payment) return NextResponse.json({ error: "Betaling ikke fundet" }, { status: 404 });

  await db.update(schema.payments).set({ status: "betalt" }).where(eq(schema.payments.id, paymentId));

  const [primaryBooking] = await db.select().from(schema.bookings).where(eq(schema.bookings.id, payment.bookingId));

  const groupBookings = primaryBooking.multiBookingGroupId
    ? await db
        .select()
        .from(schema.bookings)
        .where(eq(schema.bookings.multiBookingGroupId, primaryBooking.multiBookingGroupId))
    : [primaryBooking];
  const groupBookingIds = groupBookings.map((b) => b.id);

  await db
    .update(schema.bookings)
    .set({ status: "betalt", paymentStatus: "betalt" })
    .where(inArray(schema.bookings.id, groupBookingIds));

  const facilityRows = await db
    .select()
    .from(schema.facilities)
    .where(inArray(schema.facilities.id, groupBookings.map((b) => b.facilityId)));
  const facilityById = new Map(facilityRows.map((f) => [f.id, f]));
  const referenceFacility = facilityById.get(primaryBooking.facilityId)!;
  const allFacilities = await db.select().from(schema.facilities);

  // Betalte bookinger (i praksis kun pickleball-/badmintonbanerne) er altid
  // privatpersoner - foreninger kan ikke booke dem (se hiddenFromOrgPortal) -
  // så den eneste afgørende faktor her er om lokalet har en kodedør, jf.
  // src/lib/accessCodes.ts. Banerne bruger Træningshallens dør, og deler
  // (ved en flerbane-bestilling) samme ÉN kode i stedet for én hver.
  const code = await maybeCreateAccessCode({
    bookingId: primaryBooking.id,
    organizationId: primaryBooking.organizationId,
    facility: referenceFacility,
    allFacilities,
    startsAt: primaryBooking.startsAt,
    endsAt: primaryBooking.endsAt,
  });
  if (code && groupBookingIds.length > 1) {
    await db
      .update(schema.bookings)
      .set({ accessCode: code })
      .where(inArray(schema.bookings.id, groupBookingIds.slice(1)));
  }

  const facilityNames = groupBookings.map((b) => facilityById.get(b.facilityId)?.name ?? "Ukendt facilitet");
  await db.insert(schema.notificationLog).values({
    id: newId("notif"),
    bookingId: primaryBooking.id,
    type: "betalingskvittering",
    recipient: primaryBooking.contactEmail ?? "ukendt",
    subject: code ? "Betaling modtaget - din adgangskode" : "Betaling modtaget",
    body: code
      ? `Tak for din betaling (${facilityNames.join(", ")}). Din dørkode er ${code}, gyldig ${primaryBooking.startsAt} - ${primaryBooking.endsAt}.`
      : `Tak for din betaling (${facilityNames.join(", ")}).`,
  });

  await logAudit("booking", primaryBooking.id, "betalt", code ? `Adgangskode ${code} genereret` : undefined);

  const [updatedPrimary] = await db.select().from(schema.bookings).where(eq(schema.bookings.id, primaryBooking.id));
  const updatedGroupBookings = await db.select().from(schema.bookings).where(inArray(schema.bookings.id, groupBookingIds));

  return NextResponse.json({ booking: updatedPrimary, bookings: updatedGroupBookings, accessCode: code });
}
