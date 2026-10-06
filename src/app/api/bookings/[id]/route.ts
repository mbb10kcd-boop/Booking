import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/db";
import { eq } from "drizzle-orm";
import { nowLocalDateTimeString } from "@/lib/date";
import { logAudit } from "@/lib/audit";
import { findConflicts, findWarnings } from "@/lib/conflicts";
import { notifyCancellation, notifyMove } from "@/lib/notifications";
import { resetAccessCodeForBooking, revokeAccessCodesForBooking } from "@/lib/accessCodes";

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
  // "silent" undertrykker aflysnings-/flyttemails (bruges fx til at rydde gamle
  // demobookinger op uden at forvirre foreninger) - heller ikke en kolonne.
  const { force, silent, ...body } = await req.json();
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

  // Rigtig aflysning (ikke silent) -> kommer på aflysningslisten (/aflysninger).
  const listCancellation = !silent && body.status === "aflyst" && existing.status !== "aflyst";
  // Flytning af en foreningsbooking -> "flyttet til ..." på aflysningslisten.
  // Den ORIGINALE placering huskes (første gang), og flyttes bookingen tilbage
  // til den, fjernes markeringen igen.
  let movedFields: Record<string, string | null> = {};
  if (!silent && timeOrFacilityChanged && existing.organizationId && existing.status !== "aflyst" && existing.status !== "afvist" && body.status !== "aflyst") {
    const baseFacility = existing.movedFromFacilityId ?? existing.facilityId;
    const baseStart = existing.movedFromStartsAt ?? existing.startsAt;
    const baseEnd = existing.movedFromEndsAt ?? existing.endsAt;
    const backHome = nextFacilityId === baseFacility && nextStartsAt === baseStart && nextEndsAt === baseEnd;
    movedFields = backHome
      ? { movedFromFacilityId: null, movedFromStartsAt: null, movedFromEndsAt: null }
      : { movedFromFacilityId: baseFacility, movedFromStartsAt: baseStart, movedFromEndsAt: baseEnd };
  }
  await db
    .update(schema.bookings)
    .set({
      ...body,
      ...movedFields,
      ...(listCancellation ? { cancelledAt: nowLocalDateTimeString() } : {}),
      updatedAt: new Date().toISOString(),
    })
    .where(eq(schema.bookings.id, id));

  // Tid og/eller facilitet ændret: en evt. eksisterende adgangskode gælder
  // muligvis et forkert tidsrum eller en forkert dør nu (eller er slet ikke
  // længere berettiget, fx hvis bookingen flyttes til et lokale uden
  // kodedør) - se src/lib/accessCodes.ts. En kode i WeAccess flyttes med
  // (samme kode); ellers nulstilles og beregnes den forfra. Aflyses/afvises
  // bookingen, spærres koden på låsen med det samme.
  const nextStatus = body.status ?? existing.status;
  const nextInactive = nextStatus === "aflyst" || nextStatus === "afvist";
  if (nextInactive) {
    await revokeAccessCodesForBooking(id);
  } else if (timeOrFacilityChanged) {
    const [nextFacility] = await db.select().from(schema.facilities).where(eq(schema.facilities.id, nextFacilityId));
    const allFacilities = await db.select().from(schema.facilities);
    await resetAccessCodeForBooking({
      bookingId: id,
      organizationId: body.organizationId ?? existing.organizationId,
      facility: nextFacility,
      allFacilities,
      startsAt: nextStartsAt,
      endsAt: nextEndsAt,
      status: nextStatus,
    });
  }

  const action = body.status === "aflyst" ? "aflyst" : timeOrFacilityChanged ? "flyttet" : "opdateret";
  await logAudit("booking", id, action, JSON.stringify(body));

  const [updated] = await db.select().from(schema.bookings).where(eq(schema.bookings.id, id));

  // Kun send aflysningsmail hvis den rent faktisk lige er blevet aflyst
  // (ikke hvis den allerede var aflyst - undgår dobbelt-besked).
  if (silent) {
    // ingen mails
  } else if (body.status === "aflyst" && existing.status !== "aflyst") {
    await notifyCancellation({ ...existing, ...body });
  } else if (timeOrFacilityChanged && updated && updated.status !== "aflyst") {
    await notifyMove(updated);
  }

  return NextResponse.json({ ...updated, warnings });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { reason } = (await req.json().catch(() => ({}))) as { reason?: string };
  const [existing] = await db.select().from(schema.bookings).where(eq(schema.bookings.id, id));
  if (!existing) return NextResponse.json({ error: "Ikke fundet" }, { status: 404 });

  await db
    .update(schema.bookings)
    .set({
      status: "aflyst",
      ...(existing.status !== "aflyst" ? { cancelledAt: nowLocalDateTimeString(), cancelReason: reason?.trim() || null } : {}),
    })
    .where(eq(schema.bookings.id, id));
  await logAudit("booking", id, "aflyst");
  await revokeAccessCodesForBooking(id);

  if (existing.status !== "aflyst") {
    await notifyCancellation(existing);
  }

  return NextResponse.json({ ok: true });
}
