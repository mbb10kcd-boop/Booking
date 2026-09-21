import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/db";
import { eq, inArray } from "drizzle-orm";
import { newId } from "@/lib/ids";
import { findConflicts } from "@/lib/conflicts";
import { logAudit } from "@/lib/audit";
import { foreningBookingConfirmationMessage } from "@/lib/ai/messages";

/**
 * Foreningsportalens bookingtrin: opretter ÉN booking pr. valgt facilitet
 * (samme dato/tidsrum), så en forening kan booke flere faciliteter på én
 * gang (fx både et mødelokale og en hal) i stedet for at skulle gennemføre
 * flowet flere gange. Kræver at foreningen er godkendt (se
 * /api/portal/organizations) - ellers kan den ikke bruges til at booke.
 */
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { organizationId, facilityIds, startsAt, endsAt, extraEmail, notes } = body as {
    organizationId?: string;
    facilityIds?: string[];
    startsAt?: string;
    endsAt?: string;
    extraEmail?: string;
    notes?: string;
  };

  if (!organizationId || !facilityIds || facilityIds.length === 0 || !startsAt || !endsAt) {
    return NextResponse.json({ error: "Udfyld venligst forening, facilitet(er), dato og tidspunkt" }, { status: 400 });
  }

  const [org] = await db.select().from(schema.organizations).where(eq(schema.organizations.id, organizationId));
  if (!org) return NextResponse.json({ error: "Forening ikke fundet" }, { status: 404 });
  if (org.status !== "godkendt") {
    return NextResponse.json({ error: "Jeres forening afventer stadig godkendelse og kan endnu ikke booke" }, { status: 403 });
  }

  const facilities = await db.select().from(schema.facilities).where(inArray(schema.facilities.id, facilityIds));
  if (facilities.length !== facilityIds.length) {
    return NextResponse.json({ error: "En eller flere faciliteter blev ikke fundet" }, { status: 404 });
  }
  const hiddenSelected = facilities.filter((f) => f.hiddenFromOrgPortal);
  if (hiddenSelected.length > 0) {
    return NextResponse.json({ error: "En eller flere valgte faciliteter kan ikke bookes af foreninger" }, { status: 400 });
  }

  // Tjek konflikt på ALLE valgte faciliteter, før nogen af dem oprettes.
  const conflictsByFacility: Record<string, number> = {};
  for (const facilityId of facilityIds) {
    const conflicts = await findConflicts(facilityId, startsAt, endsAt);
    if (conflicts.length > 0) conflictsByFacility[facilityId] = conflicts.length;
  }
  if (Object.keys(conflictsByFacility).length > 0) {
    const busyNames = facilities
      .filter((f) => conflictsByFacility[f.id])
      .map((f) => f.name);
    return NextResponse.json(
      { error: `Tiden er desværre ikke længere ledig i: ${busyNames.join(", ")}`, busyFacilityIds: Object.keys(conflictsByFacility) },
      { status: 409 }
    );
  }

  const createdBookings: (typeof schema.bookings.$inferSelect)[] = [];
  for (const facility of facilities) {
    const id = newId("book");
    await db.insert(schema.bookings).values({
      id,
      facilityId: facility.id,
      organizationId,
      title: `${facility.name} - ${org.name}`,
      contactName: org.contactName,
      contactEmail: org.contactEmail,
      contactPhone: org.contactPhone,
      extraEmail: extraEmail || null,
      startsAt,
      endsAt,
      status: "bekraeftet",
      price: 0,
      paymentStatus: "ikke_paakraevet",
      notes: notes || null,
      source: "portal",
      createdBy: org.name,
    });

    const code = String(Math.floor(1000 + Math.random() * 9000));
    await db.insert(schema.accessCodes).values({
      id: newId("code"),
      bookingId: id,
      facilityId: facility.id,
      code,
      validFrom: startsAt,
      validTo: endsAt,
      active: true,
      usageLog: [{ at: new Date().toISOString(), event: "genereret" }],
    });
    await db.update(schema.bookings).set({ accessCode: code }).where(eq(schema.bookings.id, id));
    await logAudit("booking", id, "oprettet", "Oprettet via foreningsportalen", org.name);

    const [finalBooking] = await db.select().from(schema.bookings).where(eq(schema.bookings.id, id));
    createdBookings.push(finalBooking);
  }

  // Én samlet bekræftelsesmail (ikke én pr. facilitet), til BÅDE foreningens
  // registrerede kontaktmail og den ekstra mail (hvis tilføjet).
  const recipients = Array.from(new Set([org.contactEmail, extraEmail].filter((r): r is string => !!r)));
  const message = foreningBookingConfirmationMessage({
    organizationName: org.name,
    facilityNames: facilities.map((f) => f.name),
    startsAt,
    endsAt,
    note: notes || undefined,
  });
  for (const recipient of recipients) {
    await db.insert(schema.notificationLog).values({
      id: newId("notif"),
      bookingId: createdBookings[0]?.id ?? null,
      type: "bekraeftelse",
      recipient,
      subject: "Jeres booking er bekræftet",
      body: message,
    });
  }

  return NextResponse.json({ bookings: createdBookings }, { status: 201 });
}
