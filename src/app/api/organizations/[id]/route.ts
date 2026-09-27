import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/db";
import { eq } from "drizzle-orm";
import { logAudit } from "@/lib/audit";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [org] = await db.select().from(schema.organizations).where(eq(schema.organizations.id, id));
  if (!org) return NextResponse.json({ error: "Ikke fundet" }, { status: 404 });
  const bookings = await db.select().from(schema.bookings).where(eq(schema.bookings.organizationId, id));
  return NextResponse.json({ ...org, bookings });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  await db.update(schema.organizations).set(body).where(eq(schema.organizations.id, id));
  await logAudit("organization", id, "opdateret", JSON.stringify(body));
  const [org] = await db.select().from(schema.organizations).where(eq(schema.organizations.id, id));
  return NextResponse.json(org);
}

/**
 * Sletter en forening PERMANENT - kun tilladt hvis den ikke har nogen
 * bookinger (hverken aktive eller historiske), så vi aldrig mister
 * bookinghistorik eller efterlader bookinger med en organizationId, der
 * peger på ingenting. Har foreningen bookinger, skal den i stedet arkiveres
 * (PATCH { archived: true }) - se /foreninger.
 */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [org] = await db.select().from(schema.organizations).where(eq(schema.organizations.id, id));
  if (!org) return NextResponse.json({ error: "Ikke fundet" }, { status: 404 });

  const bookings = await db.select({ id: schema.bookings.id }).from(schema.bookings).where(eq(schema.bookings.organizationId, id));
  if (bookings.length > 0) {
    return NextResponse.json(
      { error: `Foreningen har ${bookings.length} booking(er) og kan ikke slettes permanent - arkivér den i stedet.` },
      { status: 400 },
    );
  }

  await db.delete(schema.organizations).where(eq(schema.organizations.id, id));
  await logAudit("organization", id, "slettet", `Forening "${org.name}" slettet permanent`);
  return NextResponse.json({ ok: true });
}
