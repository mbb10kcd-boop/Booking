import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/db";
import { eq } from "drizzle-orm";
import { newId } from "@/lib/ids";
import { findConflicts } from "@/lib/conflicts";
import { logAudit } from "@/lib/audit";
import { confirmationMessage } from "@/lib/ai/messages";
import { maybeCreateAccessCode } from "@/lib/accessCodes";

/** Offentlig bookingportal: opret en booking som ekstern gæst (privatperson) */
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { facilityId, startsAt, endsAt, name, email, phone } = body;
  if (!facilityId || !startsAt || !endsAt || !name || !email) {
    return NextResponse.json({ error: "Udfyld venligst alle felter" }, { status: 400 });
  }

  const [facility] = await db.select().from(schema.facilities).where(eq(schema.facilities.id, facilityId));
  if (!facility) return NextResponse.json({ error: "Facilitet ikke fundet" }, { status: 404 });

  const conflicts = await findConflicts(facilityId, startsAt, endsAt);
  if (conflicts.length > 0) {
    return NextResponse.json({ error: "Tiden er desværre ikke længere ledig" }, { status: 409 });
  }

  const requiresPayment = !!facility.requiresPayment;
  const id = newId("book");
  await db.insert(schema.bookings).values({
    id,
    facilityId,
    title: `${facility.name} - ${name}`,
    contactName: name,
    contactEmail: email,
    contactPhone: phone ?? null,
    startsAt,
    endsAt,
    status: requiresPayment ? "midlertidig" : "bekraeftet",
    price: facility.pricePerHour ?? 0,
    paymentStatus: requiresPayment ? "afventer" : "ikke_paakraevet",
    source: "portal",
    createdBy: name,
  });

  let paymentId: string | null = null;
  if (requiresPayment) {
    paymentId = newId("pay");
    const hours = (new Date(endsAt).getTime() - new Date(startsAt).getTime()) / 3_600_000;
    await db.insert(schema.payments).values({
      id: paymentId,
      bookingId: id,
      amount: Math.round((facility.pricePerHour ?? 0) * hours * 100) / 100,
      vat: 0,
      status: "afventer",
      provider: "ikke_valgt",
    });
    // Adgangskode genereres først når betalingen er gennemført - se
    // /api/portal/pay/[paymentId].
  } else {
    // Ingen betaling påkrævet -> generér ev. adgangskode med det samme.
    // Kun relevant for privatpersoner i et lokale med kodedør (Træningshallen
    // eller Multisalen) - se src/lib/accessCodes.ts. Denne booking har ingen
    // organizationId (det er den offentlige PRIVATPERSON-portal), så den
    // eneste afgørende faktor her er om lokalet har en kodedør.
    const allFacilities = await db.select().from(schema.facilities);
    const code = await maybeCreateAccessCode({
      bookingId: id,
      organizationId: null,
      facility,
      allFacilities,
      startsAt,
      endsAt,
    });

    await db.insert(schema.notificationLog).values({
      id: newId("notif"),
      bookingId: id,
      type: "bekraeftelse",
      recipient: email,
      subject: "Din booking er bekræftet",
      body: confirmationMessage({ facilityName: facility.name, startsAt, endsAt, recipientName: name, accessCode: code }),
    });
  }

  await logAudit("booking", id, "oprettet", "Oprettet via offentlig bookingportal", name);

  const [finalBooking] = await db.select().from(schema.bookings).where(eq(schema.bookings.id, id));
  return NextResponse.json({ booking: finalBooking, requiresPayment, paymentId }, { status: 201 });
}
