import { NextResponse } from "next/server";
import { db, schema } from "@/db";
import { localISODate } from "@/lib/date";

export async function GET() {
  const todayStr = localISODate();
  const facilities = await db.select().from(schema.facilities);
  const bookings = await db.select().from(schema.bookings);
  const orgs = await db.select().from(schema.organizations);

  const todays = bookings
    .filter((b) => b.startsAt.slice(0, 10) === todayStr && b.status !== "aflyst" && b.status !== "afvist")
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
    .map((b) => ({
      ...b,
      facilityName: facilities.find((f) => f.id === b.facilityId)?.name ?? "Ukendt facilitet",
      organizationName: orgs.find((o) => o.id === b.organizationId)?.name,
    }));

  return NextResponse.json(todays);
}
