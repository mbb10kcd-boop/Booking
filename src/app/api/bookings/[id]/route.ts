import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/db";
import { eq } from "drizzle-orm";
import { logAudit } from "@/lib/audit";
import { findConflicts, findWarnings } from "@/lib/conflicts";
import { notifyCancellation, notifyMove } from "@/lib/notifications";

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

  const [updated] = await db.select().from(schema.bookings).where(eq(schema.bookings.id, id));

  // Kun send aflysningsmail hvis den rent faktisk lige er blevet aflyst
  // (ikke hvis den allerede var aflyst - undgår dobbelt-besked).
  if (body.status === "aflyst" && existing.status !== "aflyst") {
    await notifyCancellation({ ...existing, ...body });
  } else if (timeOrFacilityChanged && updated && updated.status !== "aflyst") {
    await notifyMove(updated);
  }

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
