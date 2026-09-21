import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/db";

const INACTIVE_STATUSES = new Set(["aflyst", "afvist"]);

/**
 * Offentligt, MINIMALT ledighedsoverblik til foreningsportalens kalendervisning:
 * returnerer KUN facilityId + tidsrum for optagne bookinger i perioden - aldrig
 * kontaktoplysninger (navn/mail/telefon), da dette endpoint er tilgængeligt uden
 * login. Bruges udelukkende til at vise "ledig/optaget" i kalenderen; den
 * autoritative konflikttjek ved selve bookingen sker stadig via
 * /api/bookings/check-conflict (som også tager højde for facilitetshierarkiet,
 * fx at hele Træningshallen er optaget hvis en badmintonbane er booket).
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const facilityIdsParam = searchParams.get("facilityIds");
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  if (!facilityIdsParam || !from || !to) {
    return NextResponse.json({ error: "facilityIds, from og to er påkrævet" }, { status: 400 });
  }
  const facilityIds = new Set(facilityIdsParam.split(","));

  const rows = await db.select().from(schema.bookings);
  const busy = rows
    .filter((b) => facilityIds.has(b.facilityId))
    .filter((b) => !INACTIVE_STATUSES.has(b.status))
    .filter((b) => b.endsAt > from && b.startsAt < to)
    .map((b) => ({ facilityId: b.facilityId, startsAt: b.startsAt, endsAt: b.endsAt }));

  return NextResponse.json(busy);
}
