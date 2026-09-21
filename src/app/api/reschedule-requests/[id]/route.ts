import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/db";
import { eq, inArray } from "drizzle-orm";
import { newId } from "@/lib/ids";
import { findConflicts } from "@/lib/conflicts";
import { logAudit } from "@/lib/audit";
import { foreningBookingConfirmationMessage, rescheduleRejectedMessage } from "@/lib/ai/messages";
import { notifyCancellation } from "@/lib/notifications";

/**
 * Personalets godkendelse/afvisning af en anmodning om aflysning/flytning
 * (oprettet via /api/portal/request-reschedule, når en forening forsøgte at
 * booke en optaget tid). Se /anmodninger for admin-UI'et.
 *
 * - "afvist": intet ændres ved den eksisterende booking. Kun den ANMODENDE
 *   forening får besked - den forening der allerede havde tiden skal
 *   selvfølgelig ikke have en mail, når intet ændrer sig for dem.
 * - "godkendt": de(n) booking(er), der p.t. konflikter med det ønskede
 *   tidsrum (tjekkes friskt her, i tilfælde af at personalet allerede selv
 *   har håndteret det manuelt siden anmodningen kom ind), aflyses - hvilket
 *   automatisk sender en aflysningsmail til den forening (samme flow som
 *   enhver anden aflysning, se notifyCancellation). Derefter oprettes den
 *   nye booking til den anmodende forening, som får en bekræftelsesmail.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { status } = (await req.json()) as { status?: "godkendt" | "afvist" };
  if (status !== "godkendt" && status !== "afvist") {
    return NextResponse.json({ error: "Ugyldig status" }, { status: 400 });
  }

  const [request] = await db.select().from(schema.rescheduleRequests).where(eq(schema.rescheduleRequests.id, id));
  if (!request) return NextResponse.json({ error: "Ikke fundet" }, { status: 404 });
  if (request.status !== "afventer") {
    return NextResponse.json({ error: "Anmodningen er allerede afgjort" }, { status: 400 });
  }

  const [org] = await db.select().from(schema.organizations).where(eq(schema.organizations.id, request.organizationId));
  if (!org) return NextResponse.json({ error: "Foreningen findes ikke længere" }, { status: 404 });

  const facilities = await db.select().from(schema.facilities).where(inArray(schema.facilities.id, request.facilityIds));

  if (status === "afvist") {
    await db
      .update(schema.rescheduleRequests)
      .set({ status: "afvist", decidedAt: new Date().toISOString() })
      .where(eq(schema.rescheduleRequests.id, id));
    await logAudit("reschedule_request", id, "afvist", undefined, "Personalet");

    const recipients = Array.from(new Set([org.contactEmail, request.extraEmail].filter((r): r is string => !!r)));
    const message = rescheduleRejectedMessage({
      facilityNames: facilities.map((f) => f.name),
      startsAt: request.startsAt,
      endsAt: request.endsAt,
      organizationName: org.name,
    });
    for (const recipient of recipients) {
      await db.insert(schema.notificationLog).values({
        id: newId("notif"),
        bookingId: null,
        type: "afvisning",
        recipient,
        subject: "Jeres anmodning er afvist",
        body: message,
      });
    }
    return NextResponse.json({ id, status: "afvist" });
  }

  // Godkendt: tjek konflikter friskt (situationen kan have ændret sig siden
  // anmodningen blev sendt), aflys det der p.t. er i vejen, og opret så den
  // nye booking til den anmodende forening.
  const conflictingBookingIds = new Set<string>();
  for (const facilityId of request.facilityIds) {
    const conflicts = await findConflicts(facilityId, request.startsAt, request.endsAt);
    conflicts.forEach((c) => conflictingBookingIds.add(c.id));
  }
  for (const bookingId of conflictingBookingIds) {
    const [existing] = await db.select().from(schema.bookings).where(eq(schema.bookings.id, bookingId));
    if (!existing || existing.status === "aflyst") continue;
    await db
      .update(schema.bookings)
      .set({ status: "aflyst", updatedAt: new Date().toISOString() })
      .where(eq(schema.bookings.id, bookingId));
    await logAudit("booking", bookingId, "aflyst", `Aflyst for at imødekomme anmodning fra ${org.name}`, "Personalet");
    await notifyCancellation(existing);
  }

  const createdBookings: (typeof schema.bookings.$inferSelect)[] = [];
  for (const facility of facilities) {
    const bookingId = newId("book");
    await db.insert(schema.bookings).values({
      id: bookingId,
      facilityId: facility.id,
      organizationId: org.id,
      title: `${facility.name} - ${org.name}`,
      contactName: org.contactName,
      contactEmail: org.contactEmail,
      contactPhone: org.contactPhone,
      extraEmail: request.extraEmail,
      startsAt: request.startsAt,
      endsAt: request.endsAt,
      status: "bekraeftet",
      price: 0,
      paymentStatus: "ikke_paakraevet",
      notes: request.notes,
      source: "portal",
      createdBy: org.name,
    });
    const code = String(Math.floor(1000 + Math.random() * 9000));
    await db.insert(schema.accessCodes).values({
      id: newId("code"),
      bookingId,
      facilityId: facility.id,
      code,
      validFrom: request.startsAt,
      validTo: request.endsAt,
      active: true,
      usageLog: [{ at: new Date().toISOString(), event: "genereret" }],
    });
    await db.update(schema.bookings).set({ accessCode: code }).where(eq(schema.bookings.id, bookingId));
    await logAudit("booking", bookingId, "oprettet", `Oprettet ved godkendelse af anmodning fra ${org.name}`, "Personalet");
    const [finalBooking] = await db.select().from(schema.bookings).where(eq(schema.bookings.id, bookingId));
    createdBookings.push(finalBooking);
  }

  const recipients = Array.from(new Set([org.contactEmail, request.extraEmail].filter((r): r is string => !!r)));
  const message = foreningBookingConfirmationMessage({
    organizationName: org.name,
    facilityNames: facilities.map((f) => f.name),
    startsAt: request.startsAt,
    endsAt: request.endsAt,
    note: request.notes || undefined,
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

  await db
    .update(schema.rescheduleRequests)
    .set({ status: "godkendt", decidedAt: new Date().toISOString() })
    .where(eq(schema.rescheduleRequests.id, id));
  await logAudit("reschedule_request", id, "godkendt", undefined, "Personalet");

  return NextResponse.json({ id, status: "godkendt", bookings: createdBookings });
}
