import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/db";
import { eq } from "drizzle-orm";
import { logAudit } from "@/lib/audit";
import { findConflicts } from "@/lib/conflicts";

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
  const body = await req.json();
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

  if (timeOrFacilityChanged && !body.force) {
    const conflicts = await findConflicts(nextFacilityId, nextStartsAt, nextEndsAt, id);
    if (conflicts.length > 0) {
      return NextResponse.json({ error: "konflikt", conflicts }, { status: 409 });
    }
  }

  await db
    .update(schema.bookings)
    .set({ ...body, updatedAt: new Date().toISOString() })
    .where(eq(schema.bookings.id, id));

  const action = body.status === "aflyst" ? "aflyst" : timeOrFacilityChanged ? "flyttet" : "opdateret";
  await logAudit("booking", id, action, JSON.stringify(body));

  const [updated] = await db.select().from(schema.bookings).where(eq(schema.bookings.id, id));
  return NextResponse.json(updated);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await db.update(schema.bookings).set({ status: "aflyst" }).where(eq(schema.bookings.id, id));
  await logAudit("booking", id, "aflyst");
  return NextResponse.json({ ok: true });
}
