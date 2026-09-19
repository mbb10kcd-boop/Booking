import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/db";
import { newId } from "@/lib/ids";
import { eq } from "drizzle-orm";

/**
 * Genererer en adgangskode til en booking. Dette er en simpel intern
 * kodegenerator (MVP). Interfacet er bevidst adskilt fra bookinglogikken,
 * så et rigtigt låsesystem (fx et fabrikat med eget API) kan kobles til
 * senere ved blot at udskifte denne fils implementation.
 */
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { bookingId } = body;
  const [booking] = await db.select().from(schema.bookings).where(eq(schema.bookings.id, bookingId));
  if (!booking) return NextResponse.json({ error: "Booking ikke fundet" }, { status: 404 });

  const code = String(Math.floor(1000 + Math.random() * 9000));
  const id = newId("code");
  await db.insert(schema.accessCodes).values({
    id,
    bookingId,
    facilityId: booking.facilityId,
    code,
    validFrom: booking.startsAt,
    validTo: booking.endsAt,
    active: true,
    usageLog: [{ at: new Date().toISOString(), event: "genereret" }],
  });
  await db.update(schema.bookings).set({ accessCode: code }).where(eq(schema.bookings.id, bookingId));

  return NextResponse.json({ code, id }, { status: 201 });
}

export async function GET() {
  const codes = await db.select().from(schema.accessCodes);
  return NextResponse.json(codes);
}
