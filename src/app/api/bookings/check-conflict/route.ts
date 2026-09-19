import { NextRequest, NextResponse } from "next/server";
import { findConflicts, suggestAlternativeTimes, suggestAlternativeFacilities } from "@/lib/conflicts";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { facilityId, startsAt, endsAt, excludeBookingId } = body;
  const conflicts = await findConflicts(facilityId, startsAt, endsAt, excludeBookingId);

  if (conflicts.length === 0) {
    return NextResponse.json({ status: "ledig", conflicts: [] });
  }

  const [altTimes, altFacilities] = await Promise.all([
    suggestAlternativeTimes(facilityId, startsAt, endsAt),
    suggestAlternativeFacilities(facilityId, startsAt, endsAt),
  ]);

  return NextResponse.json({
    status: "konflikt",
    conflicts,
    suggestions: { alternativeTimes: altTimes, alternativeFacilityIds: altFacilities },
  });
}
