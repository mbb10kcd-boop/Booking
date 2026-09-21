import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/db";
import { eq } from "drizzle-orm";
import { localISODate } from "@/lib/date";

/**
 * Returnerer dagens program for en given infoskærm, klar til visning.
 *
 * Skærmene hænger fast og kan ikke scrolles, så udvalget af faciliteter skal
 * altid kunne være på skærmen uden at løbe over (Martin). Derfor skelnes der
 * mellem to slags faciliteter for skærmen:
 *
 * - "Pinnede" faciliteter (screen.pinnedFacilityIds) vises ALTID, også hvis
 *   de er helt ledige i dag (fx de store haller på oversigtsskærmen).
 * - Øvrige faciliteter i skærmens omfang (screen.facilityIds, eller alle
 *   ikke-skjulte faciliteter hvis den er tom) vises KUN de dage, hvor de rent
 *   faktisk har mindst én booking - så skærmen ikke bruger plads på tomme
 *   lokaler.
 *
 * Faciliteter markeret hiddenFromInfoScreen (badmintonbanerne) er altid
 * udelukket, uanset skærmens opsætning.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [screen] = await db.select().from(schema.infoScreens).where(eq(schema.infoScreens.id, id));
  if (!screen) return NextResponse.json({ error: "Skærm ikke fundet" }, { status: 404 });

  const allFacilities = await db.select().from(schema.facilities);
  const visibleFacilities = allFacilities.filter((f) => !f.hiddenFromInfoScreen);
  const visibleFacilityIds = new Set(visibleFacilities.map((f) => f.id));

  const configuredScope = screen.facilityIds && screen.facilityIds.length > 0 ? screen.facilityIds : visibleFacilities.map((f) => f.id);
  const scopeFacilityIds = configuredScope.filter((fid) => visibleFacilityIds.has(fid));

  const pinnedFacilityIds = (screen.pinnedFacilityIds ?? []).filter((fid) => visibleFacilityIds.has(fid));
  const pinnedSet = new Set(pinnedFacilityIds);

  const todayStr = localISODate();
  const allBookings = await db.select().from(schema.bookings);
  const todaysBookings = allBookings
    .filter(
      (b) =>
        scopeFacilityIds.includes(b.facilityId) &&
        b.startsAt.slice(0, 10) === todayStr &&
        b.status !== "aflyst" &&
        b.status !== "afvist"
    )
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));

  const bookedFacilityIds = new Set(todaysBookings.map((b) => b.facilityId));

  // Pinnede faciliteter først (i den rækkefølge de er angivet), derefter de
  // øvrige faciliteter i skærmens omfang der rent faktisk har en booking i
  // dag - sorteret efter facilitetens sortOrder, ligesom resten af systemet.
  const conditionalIds = scopeFacilityIds
    .filter((fid) => !pinnedSet.has(fid) && bookedFacilityIds.has(fid))
    .sort((a, b) => {
      const fa = allFacilities.find((f) => f.id === a)?.sortOrder ?? 0;
      const fb = allFacilities.find((f) => f.id === b)?.sortOrder ?? 0;
      return fa - fb;
    });

  const finalFacilityIds = [...pinnedFacilityIds, ...conditionalIds];

  const byFacility = finalFacilityIds.map((fid) => ({
    facility: allFacilities.find((f) => f.id === fid),
    bookings: todaysBookings.filter((b) => b.facilityId === fid),
  }));

  return NextResponse.json({ screen, byFacility, generatedAt: new Date().toISOString() });
}
