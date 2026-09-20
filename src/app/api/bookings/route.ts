import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/db";
import { and, eq, gte, lte, or } from "drizzle-orm";
import { newId } from "@/lib/ids";
import { logAudit } from "@/lib/audit";
import { findConflicts, findWarnings } from "@/lib/conflicts";
import { confirmationMessage } from "@/lib/ai/messages";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  let rows = await db.select().from(schema.bookings);

  if (from) rows = rows.filter((b) => b.endsAt >= from);
  if (to) rows = rows.filter((b) => b.startsAt <= to);

  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { facilityId, startsAt, endsAt, force } = body;

  if (!facilityId || !startsAt || !endsAt) {
    return NextResponse.json({ error: "facilityId, startsAt og endsAt er påkrævet" }, { status: 400 });
  }

  const conflicts = await findConflicts(facilityId, startsAt, endsAt);
  if (conflicts.length > 0 && !force) {
    return NextResponse.json(
      { error: "konflikt", conflicts },
      { status: 409 }
    );
  }

  // Hvis der ikke er sendt en titel, brug foreningens navn i stedet for det
  // generiske "Booking" - samme fallback som i BookingFormModal, men også
  // håndhævet her så det gælder uanset hvor kaldet kommer fra (fx portalen).
  let fallbackTitle = "Booking";
  if (!body.title && body.organizationId) {
    const [org] = await db.select().from(schema.organizations).where(eq(schema.organizations.id, body.organizationId));
    if (org?.name) fallbackTitle = org.name;
  }

  const id = newId("book");
  const booking = {
    id,
    facilityId,
    organizationId: body.organizationId ?? null,
    title: body.title || fallbackTitle,
    contactName: body.contactName ?? null,
    contactEmail: body.contactEmail ?? null,
    contactPhone: body.contactPhone ?? null,
    startsAt,
    endsAt,
    status: body.status ?? "reserveret",
    seasonGroupId: body.seasonGroupId ?? null,
    recurrenceRule: body.recurrenceRule ?? null,
    price: body.price ?? 0,
    paymentStatus: body.paymentStatus ?? "ikke_paakraevet",
    notes: body.notes ?? null,
    source: body.source ?? "manuel",
    createdBy: body.createdBy ?? "Medarbejder",
  };

  await db.insert(schema.bookings).values(booking);
  await logAudit("booking", id, "oprettet", `${booking.title} oprettet (${booking.source})`, booking.createdBy ?? undefined);

  // Send (simuleret) bekræftelsesmail, hvis vi har en kontaktmail - enten
  // indtastet direkte, eller foreslået fra den valgte forening. Se
  // /notifikationer for de genererede beskeder (ingen rigtig mailudbyder
  // koblet på endnu, jf. ARKITEKTUR.md).
  if (booking.contactEmail) {
    const [facility] = await db.select().from(schema.facilities).where(eq(schema.facilities.id, facilityId));
    const message = confirmationMessage({
      facilityName: facility?.name ?? "faciliteten",
      startsAt: booking.startsAt,
      endsAt: booking.endsAt,
      recipientName: booking.contactName ?? undefined,
    });
    await db.insert(schema.notificationLog).values({
      id: newId("notif"),
      bookingId: id,
      type: "bekraeftelse",
      recipient: booking.contactEmail,
      subject: "Bekræftelse af jeres booking",
      body: message,
    });
  }

  // Løst koblede faciliteter (fx klatrevæg/opvisningshal) blokerer ikke
  // bookingen, men flages som en bemærkning til den der booker.
  const warnings = await findWarnings(facilityId, startsAt, endsAt);

  return NextResponse.json(
    { booking, overriddenConflicts: force ? conflicts : [], warnings },
    { status: 201 }
  );
}
