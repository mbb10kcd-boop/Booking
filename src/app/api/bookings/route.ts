import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/db";
import { and, gte, lte, or } from "drizzle-orm";
import { newId } from "@/lib/ids";
import { logAudit } from "@/lib/audit";
import { findConflicts } from "@/lib/conflicts";

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

  const id = newId("book");
  const booking = {
    id,
    facilityId,
    organizationId: body.organizationId ?? null,
    title: body.title ?? "Booking",
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

  return NextResponse.json({ booking, overriddenConflicts: force ? conflicts : [] }, { status: 201 });
}
