import { NextRequest, NextResponse } from "next/server";
import { getAllFacilities, facilitiesConflict } from "@/lib/facilities";
import { loadActiveBookingsBetween, relatedFacilityIds } from "@/lib/conflicts";
import { addDays, localISODate } from "@/lib/date";

/**
 * Offentligt, MINIMALT ledighedsoverblik til privatpersonportalens tidsvælger:
 * for hver ønsket facilitet returneres de tidsrum den er optaget i (fra og med
 * `from`, `days` dage frem) - uden navne, mails eller andet personfølsomt.
 * Tager højde for facilitetshierarkiet (fx er en bane også optaget, når hele
 * Træningshallen er booket af en forening), så portalen kan vise ledige tider
 * med det samme uden at spørge serveren om hvert enkelt tidspunkt.
 * Det endelige, autoritative konflikttjek sker stadig ved selve bookingen.
 *
 * GET /api/portal/slots?facilityIds=a,b&from=2026-10-07&days=30
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const ids = (searchParams.get("facilityIds") ?? "").split(",").filter(Boolean);
  const from = searchParams.get("from") ?? "";
  const days = Math.min(60, Math.max(1, Number(searchParams.get("days") ?? 30) || 30));
  if (ids.length === 0 || !/^\d{4}-\d{2}-\d{2}$/.test(from)) {
    return NextResponse.json({ error: "facilityIds og from (YYYY-MM-DD) er påkrævet" }, { status: 400 });
  }

  const facilities = await getAllFacilities();
  const allowed = facilities
    .filter((f) => ids.includes(f.id) && !f.archived && !f.hiddenFromPrivatePortal)
    .map((f) => f.id);

  const rangeFrom = `${from}T00:00:00`;
  const rangeTo = `${localISODate(addDays(new Date(`${from}T00:00:00`), days))}T00:00:00`;
  const related = Array.from(new Set(allowed.flatMap((id) => relatedFacilityIds(id, facilities))));
  const rows = await loadActiveBookingsBetween(rangeFrom, rangeTo, related);

  const busy: Record<string, [string, string][]> = {};
  for (const id of allowed) {
    busy[id] = rows
      .filter((b) => facilitiesConflict(id, b.facilityId, facilities))
      .map((b): [string, string] => [b.startsAt.slice(0, 16), b.endsAt.slice(0, 16)]);
  }

  return NextResponse.json({ busy }, { headers: { "Cache-Control": "no-store" } });
}
