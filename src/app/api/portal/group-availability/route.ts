import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/db";
import { inArray } from "drizzle-orm";
import { findAvailableInGroup, suggestAlternativeGroupTimes } from "@/lib/conflicts";

/**
 * Ledighedstjek for en GRUPPE af indbyrdes ombyttelige faciliteter (fx de 6
 * pickleball-/badmintonbaner, se bookableGroupLabel i src/db/schema.ts) - i
 * modsætning til /api/bookings/check-conflict (som tjekker ÉN bestemt
 * facilitet) svarer dette på "er der mindst `count` ledige, ligegyldigt
 * hvilke". Bruges af den offentlige privatpersonportal, inden selve
 * bestillingen sendes til /api/portal/book-group.
 */
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { facilityIds, startsAt, endsAt, count } = body;
  if (!Array.isArray(facilityIds) || facilityIds.length === 0 || !startsAt || !endsAt || !count) {
    return NextResponse.json({ error: "facilityIds, startsAt, endsAt og count er påkrævet" }, { status: 400 });
  }

  // Bekræft at de opgivne id'er rent faktisk findes og ikke er arkiverede -
  // portalen sender selv id'erne (fra /api/facilities), men vi stoler ikke
  // blindt på klienten for et offentligt, ikke-autentificeret endpoint.
  const rows = await db.select().from(schema.facilities).where(inArray(schema.facilities.id, facilityIds));
  const validIds = rows.filter((f) => !f.archived && !f.hiddenFromPrivatePortal).map((f) => f.id);

  const available = await findAvailableInGroup(validIds, startsAt, endsAt);

  if (available.length >= count) {
    return NextResponse.json({ status: "ledig", availableFacilityIds: available });
  }

  const alternativeTimes = await suggestAlternativeGroupTimes(validIds, startsAt, endsAt, count);
  return NextResponse.json({
    status: "optaget",
    availableCount: available.length,
    availableFacilityIds: available,
    suggestions: { alternativeTimes },
  });
}
