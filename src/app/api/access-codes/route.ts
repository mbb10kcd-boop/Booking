import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/db";
import { eq } from "drizzle-orm";
import { maybeCreateAccessCode } from "@/lib/accessCodes";

/**
 * Genererer en adgangskode til en booking (generisk endpoint - bruges p.t.
 * ikke fra nogen UI, men holdes vedlige for evt. senere brug). Går gennem
 * den fælles regel i src/lib/accessCodes.ts: kun privatpersoner (ingen
 * organizationId) og kun i lokaler med en registreret kodedør
 * (weAccessDoorId - p.t. Træningshallen og Multisalen). Returnerer 400 hvis
 * bookingen ikke er berettiget til en kode.
 *
 * Interfacet er bevidst adskilt fra bookinglogikken, så et rigtigt
 * låsesystem (WeAccess har p.t. ingen offentlig API - undersøgt september
 * 2026, kontakt sales@weaccess.dk) kan kobles til senere ved at udvide
 * maybeCreateAccessCode med det faktiske kald.
 */
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { bookingId } = body;
  const [booking] = await db.select().from(schema.bookings).where(eq(schema.bookings.id, bookingId));
  if (!booking) return NextResponse.json({ error: "Booking ikke fundet" }, { status: 404 });

  const [facility] = await db.select().from(schema.facilities).where(eq(schema.facilities.id, booking.facilityId));
  if (!facility) return NextResponse.json({ error: "Facilitet ikke fundet" }, { status: 404 });

  const allFacilities = await db.select().from(schema.facilities);
  const code = await maybeCreateAccessCode({
    bookingId: booking.id,
    organizationId: booking.organizationId,
    facility,
    allFacilities,
    startsAt: booking.startsAt,
    endsAt: booking.endsAt,
  });

  if (!code) {
    return NextResponse.json(
      { error: "Denne booking er ikke berettiget til en adgangskode (forening, eller lokale uden kodedør)" },
      { status: 400 }
    );
  }

  return NextResponse.json({ code }, { status: 201 });
}

export async function GET() {
  const codes = await db.select().from(schema.accessCodes);
  return NextResponse.json(codes);
}
