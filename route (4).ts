import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/db";
import { newId } from "@/lib/ids";
import { logAudit } from "@/lib/audit";

export async function GET() {
  const facilities = await db.select().from(schema.facilities).orderBy(schema.facilities.sortOrder);
  return NextResponse.json(facilities);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const id = newId("fac");
  const facility = {
    id,
    name: body.name,
    description: body.description ?? null,
    parentId: body.parentId ?? null,
    capacity: body.capacity ?? null,
    openingHours: body.openingHours ?? null,
    pricePerHour: body.pricePerHour ?? 0,
    requiresPayment: body.requiresPayment ?? false,
    bookingTypes: body.bookingTypes ?? [],
    restrictions: body.restrictions ?? null,
    color: body.color ?? "#2563eb",
    sortOrder: body.sortOrder ?? 0,
  };
  await db.insert(schema.facilities).values(facility);
  await logAudit("facility", id, "oprettet", `Facilitet "${facility.name}" oprettet`);
  return NextResponse.json(facility, { status: 201 });
}
