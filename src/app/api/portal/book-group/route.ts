import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/db";
import { inArray } from "drizzle-orm";
import { newId } from "@/lib/ids";
import { findConflicts } from "@/lib/conflicts";
import { logAudit } from "@/lib/audit";
import { groupConfirmationMessage } from "@/lib/ai/messages";
import { maybeCreateAccessCode } from "@/lib/accessCodes";
import { sendNotification } from "@/lib/mailer";
import { checkDiscountCode, redeemDiscount, type DiscountRow } from "@/lib/discounts";

/**
 * Offentlig bookingportal: opret en bestilling af FLERE indbyrdes
 * ombyttelige faciliteter på én gang (fx 2 pickleball-/badmintonbaner), som
 * en ekstern gæst (privatperson). Modstykket til /api/portal/book, som kun
 * opretter én booking på én bestemt facilitet.
 *
 * `facilityIds` skal være de KONKRETE bane-id'er der skal bookes (typisk
 * fundet via /api/portal/group-availability lige inden), ikke bare et antal
 * - så vi undgår at skulle vælge om igen her, og undgår et race-vindue hvor
 * to gæster kunne få tildelt samme bane. Der laves dog stadig et sidste,
 * autoritativt konflikttjek af hver enkelt facilitet her, for det tilfælde
 * at en af dem lige er blevet booket af nogen andre i mellemtiden.
 */
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { facilityIds, startsAt, endsAt, name, email, phone } = body;
  if (!Array.isArray(facilityIds) || facilityIds.length === 0 || !startsAt || !endsAt || !name || !email) {
    return NextResponse.json({ error: "Udfyld venligst alle felter" }, { status: 400 });
  }

  const facilityRows = await db.select().from(schema.facilities).where(inArray(schema.facilities.id, facilityIds));
  if (facilityRows.length !== facilityIds.length) {
    return NextResponse.json({ error: "En eller flere faciliteter blev ikke fundet" }, { status: 404 });
  }
  // Server-side håndhævelse af hiddenFromPrivatePortal (se schema.ts og
  // /api/portal/book) - samme spærre som enkelt-facilitet-flowet.
  const hiddenSelected = facilityRows.filter((f) => f.hiddenFromPrivatePortal);
  if (hiddenSelected.length > 0) {
    return NextResponse.json({ error: "En eller flere valgte faciliteter kan ikke bookes af privatpersoner" }, { status: 400 });
  }
  const facilityById = new Map(facilityRows.map((f) => [f.id, f]));

  // Sidste, autoritative konflikttjek - se docstring ovenfor.
  for (const facilityId of facilityIds) {
    // eslint-disable-next-line no-await-in-loop
    const conflicts = await findConflicts(facilityId, startsAt, endsAt);
    if (conflicts.length > 0) {
      return NextResponse.json(
        { error: "En eller flere af de valgte baner er desværre ikke længere ledige - prøv igen." },
        { status: 409 }
      );
    }
  }

  // Gruppen antages ensartet (samme pris/betalingskrav) - sandt for alle
  // nuværende grupper (bookableGroupLabel bruges p.t. kun til de ensprisede
  // pickleball-/badmintonbaner). Bruger den første facilitet som reference.
  const referenceFacility = facilityRows[0];
  const facilityRequiresPayment = !!referenceFacility.requiresPayment;
  const hours = (new Date(endsAt).getTime() - new Date(startsAt).getTime()) / 3_600_000;
  const total = Math.round(facilityRows.reduce((sum, f) => sum + (f.pricePerHour ?? 0), 0) * hours * 100) / 100;

  // Rabatkode (valgfri): valideres igen her på serveren og indløses atomisk.
  let discountRow: DiscountRow | null = null;
  let discount = 0;
  let finalTotal = total;
  if (body.discountCode) {
    if (!facilityRequiresPayment || total <= 0) {
      return NextResponse.json({ error: "Rabatkode kan ikke bruges til denne booking" }, { status: 400 });
    }
    const check = await checkDiscountCode(body.discountCode, total);
    if (!check.ok) return NextResponse.json({ error: check.error }, { status: 400 });
    if (!(await redeemDiscount(check.row))) {
      return NextResponse.json({ error: "Rabatkoden er allerede brugt" }, { status: 400 });
    }
    discountRow = check.row;
    discount = check.discount;
    finalTotal = check.finalTotal;
  }
  const requiresPayment = facilityRequiresPayment && finalTotal > 0;
  const multiBookingGroupId = newId("group");

  const bookingIds: string[] = [];
  for (const facilityId of facilityIds) {
    const facility = facilityById.get(facilityId)!;
    const id = newId("book");
    bookingIds.push(id);
    // eslint-disable-next-line no-await-in-loop
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
      multiBookingGroupId,
      price: facility.pricePerHour ?? 0,
      paymentStatus: requiresPayment ? "afventer" : "ikke_paakraevet",
      discountCode: discountRow?.code ?? null,
      source: "portal",
      createdBy: name,
    });
  }
  await logAudit(
    "booking",
    multiBookingGroupId,
    "oprettet",
    `${facilityIds.length} baner (${facilityRows.map((f) => f.name).join(", ")}) oprettet via offentlig bookingportal`,
    name
  );

  let paymentId: string | null = null;
  if (requiresPayment) {
    paymentId = newId("pay");
    // Betalingen dækker HELE gruppen, men peger (af skemamæssige årsager, se
    // schema.ts) kun på den første booking - se /api/portal/pay/[paymentId],
    // som ved betaling opdaterer ALLE bookinger i samme multiBookingGroupId.
    await db.insert(schema.payments).values({
      id: paymentId,
      bookingId: bookingIds[0],
      amount: finalTotal,
      discount,
      vat: 0,
      status: "afventer",
      provider: "ikke_valgt",
    });
  } else {
    if (discountRow) {
      await db.insert(schema.payments).values({
        id: newId("pay"),
        bookingId: bookingIds[0],
        amount: 0,
        discount,
        vat: 0,
        status: "betalt",
        provider: "rabatkode",
        providerRef: discountRow.code,
      });
    }
    // Ingen betaling påkrævet - generér med det samme ÉN fælles adgangskode
    // til hele gruppen (de deler jo samme fysiske dør), i stedet for én kode
    // pr. bane.
    const allFacilities = await db.select().from(schema.facilities);
    const code = await maybeCreateAccessCode({
      bookingId: bookingIds[0],
      organizationId: null,
      facility: referenceFacility,
      allFacilities,
      startsAt,
      endsAt,
    });
    if (code) {
      await db
        .update(schema.bookings)
        .set({ accessCode: code })
        .where(inArray(schema.bookings.id, bookingIds.slice(1)));
    }
    await sendNotification({
      id: newId("notif"),
      bookingId: bookingIds[0],
      type: "bekraeftelse",
      recipient: email,
      subject: "Din booking er bekræftet",
      body: groupConfirmationMessage({
        facilityNames: facilityRows.map((f) => f.name),
        startsAt,
        endsAt,
        recipientName: name,
        accessCode: code,
      }),
    });
  }

  const finalBookings = await db.select().from(schema.bookings).where(inArray(schema.bookings.id, bookingIds));
  return NextResponse.json({ bookings: finalBookings, requiresPayment, paymentId }, { status: 201 });
}
