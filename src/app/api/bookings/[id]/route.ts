import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/db";
import { eq } from "drizzle-orm";
import { logAudit } from "@/lib/audit";
import { findConflicts, findWarnings } from "@/lib/conflicts";
import { cancellationMessage } from "@/lib/ai/messages";
import { newId } from "@/lib/ids";

/**
 * Sender (simuleret) aflysningsmail til en bookings kontakt - falder tilbage
 * til foreningens registrerede kontaktmail, hvis bookingen ikke selv har en
 * (samme mønster som ved "overtag tid" i mailindbakken, se inboxActions.ts).
 */
async function notifyCancellation(booking: typeof schema.bookings.$inferSelect) {
  let recipient = booking.contactEmail;
  if (!recipient && booking.organizationId) {
    const [org] = await db.select().from(schema.organizations).where(eq(schema.organizations.id, booking.organizationId));
    recipient = org?.contactEmail ?? null;
  }
  if (!recipient) return;

  const [facility] = await db.select().from(schema.facilities).where(eq(schema.facilities.id, booking.facilityId));
  const message = cancellationMessage({
    facilityName: facility?.name ?? "faciliteten",
    startsAt: booking.startsAt,
    endsAt: booking.endsAt,
    recipientName: booking.contactName ?? undefined,
  });
  await db.insert(schema.notificationLog).values({
    id: newId("notif"),
    bookingId: booking.id,
    type: "aflysning",
    recipient,
    subject: "Aflysning af jeres booking",
    body: message,
  });
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [booking] = await db.select().from(schema.bookings).where(eq(schema.bookings.id, id));
  if (!booking) return NextResponse.json({ error: "Ikke fundet" }, { status: 404 });
  const history = await db
    .select()
    .from(schema.auditLog)
    .where(eq(schema.auditLog.entityId, id));
  return NextResponse.json({ ...booking, history });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // "force" er kun et signal til konflikttjekket herunder, ikke en kolonne i
  // bookings-tabellen - fjernes fra `body`, inden den bruges til `.set()`.
  const { force, ...body } = await req.json();
  const [existing] = await db.select().from(schema.bookings).where(eq(schema.bookings.id, id));
  if (!existing) return NextResponse.json({ error: "Ikke fundet" }, { status: 404 });

  // Hvis tidspunkt eller facilitet ændres, tjek for konflikt (medmindre force)
  const nextFacilityId = body.facilityId ?? existing.facilityId;
  const nextStartsAt = body.startsAt ?? existing.startsAt;
  const nextEndsAt = body.endsAt ?? existing.endsAt;
  const timeOrFacilityChanged =
    nextFacilityId !== existing.facilityId ||
    nextStartsAt !== existing.startsAt ||
    nextEndsAt !== existing.endsAt;

  if (timeOrFacilityChanged && !force) {
    const conflicts = await findConflicts(nextFacilityId, nextStartsAt, nextEndsAt, id);
    if (conflicts.length > 0) {
      return NextResponse.json({ error: "konflikt", conflicts }, { status: 409 });
    }
  }

  // Løst koblede faciliteter (fx klatrevæg/opvisningshal) blokerer ikke,
  // men flages som en bemærkning - kun relevant når tid/facilitet ændres.
  const warnings = timeOrFacilityChanged
    ? await findWarnings(nextFacilityId, nextStartsAt, nextEndsAt, id)
    : [];

  await db
    .update(schema.bookings)
    .set({ ...body, updatedAt: new Date().toISOString() })
    .where(eq(schema.bookings.id, id));

  const action = body.status === "aflyst" ? "aflyst" : timeOrFacilityChanged ? "flyttet" : "opdateret";
  await logAudit("booking", id, action, JSON.stringify(body));

  // Kun send aflysningsmail hvis den rent faktisk lige er blevet aflyst
  // (ikke hvis den allerede var aflyst - undgår dobbelt-besked).
  if (body.status === "aflyst" && existing.status !== "aflyst") {
    await notifyCancellation({ ...existing, ...body });
  }

  const [updated] = await db.select().from(schema.bookings).where(eq(schema.bookings.id, id));
  return NextResponse.json({ ...updated, warnings });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [existing] = await db.select().from(schema.bookings).where(eq(schema.bookings.id, id));
  if (!existing) return NextResponse.json({ error: "Ikke fundet" }, { status: 404 });

  await db.update(schema.bookings).set({ status: "aflyst" }).where(eq(schema.bookings.id, id));
  await logAudit("booking", id, "aflyst");

  if (existing.status !== "aflyst") {
    await notifyCancellation(existing);
  }

  return NextResponse.json({ ok: true });
}
