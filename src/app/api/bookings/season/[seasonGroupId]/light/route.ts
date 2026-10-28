import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/db";
import { and, eq, gte, notInArray } from "drizzle-orm";
import { logAudit } from "@/lib/audit";
import { normalizeLightLevel } from "@/lib/lightLevels";

/**
 * Sætter lysniveauet (400/700/1000 lux) på en booking i en sæson OG alle
 * senere, ikke-aflyste forekomster af sæsonen - så man ikke skal rette hver
 * uge for sig. Body: { anchorBookingId, lightLevel }. Allerede overståede
 * forekomster (før ankeret) røres ikke.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ seasonGroupId: string }> }) {
  const { seasonGroupId } = await params;
  const { anchorBookingId, lightLevel } = await req.json();
  if (!anchorBookingId) return NextResponse.json({ error: "anchorBookingId er påkrævet" }, { status: 400 });

  const [anchor] = await db.select().from(schema.bookings).where(eq(schema.bookings.id, anchorBookingId));
  if (!anchor || anchor.seasonGroupId !== seasonGroupId) {
    return NextResponse.json({ error: "Ikke fundet" }, { status: 404 });
  }
  const level = normalizeLightLevel(lightLevel);
  const rows = await db
    .select({ id: schema.bookings.id })
    .from(schema.bookings)
    .where(
      and(
        eq(schema.bookings.seasonGroupId, seasonGroupId),
        gte(schema.bookings.startsAt, anchor.startsAt),
        notInArray(schema.bookings.status, ["aflyst", "afvist"])
      )
    );
  for (const r of rows) {
    await db.update(schema.bookings).set({ lightLevel: level, updatedAt: new Date().toISOString() }).where(eq(schema.bookings.id, r.id));
  }
  await logAudit("booking", anchorBookingId, "lysniveau", `${level} lux på ${rows.length} forekomster af sæsonen`);
  return NextResponse.json({ updated: rows.length, lightLevel: level });
}
