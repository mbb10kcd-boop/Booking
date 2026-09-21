import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/db";
import { eq } from "drizzle-orm";
import { logAudit } from "@/lib/audit";
import { findConflicts, findWarnings } from "@/lib/conflicts";
import { notifyCancellation, notifyMove } from "@/lib/notifications";
import { maybeCreateAccessCode } from "@/lib/accessCodes";

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

  // Tid og/eller facilitet ændret: en evt. eksisterende adgangskode gælder
  // muligvis et forkert tidsrum eller en forkert dør nu (eller er slet ikke
  // længere berettiget, fx hvis bookingen flyttes til et lokale uden
  // kodedør) - se src/lib/accessCodes.ts. Nulstil og beregn i så fald forfra
  // i stedet for at lade en kode fra kodepuljen blive stående og optage
  // plads i puljen på et tidsrum den ikke længere dækker.
  if (timeOrFacilityChanged) {
    await db.delete(schema.accessCodes).where(eq(schema.accessCodes.bookingId, id));
    await db.update(schema.bookings).set({ accessCode: null }).where(eq(schema.bookings.id, id));

    const nextStatus = body.status ?? existing.status;
    if (nextStatus !== "aflyst" && nextStatus !== "afvist") {
      const [nextFacility] = await db.select().from(schema.facilities).where(eq(schema.facilities.id, nextFacilityId));
      if (nextFacility) {
        const allFacilities = await db.select().from(schema.facilities);
        await maybeCreateAccessCode({
          bookingId: id,
          organizationId: body.organizationId ?? existing.organizationId,
          facility: nextFacility,
          allFacilities,
          startsAt: nextStartsAt,
          endsAt: nextEndsAt,
        });
      }
    }
  }

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
