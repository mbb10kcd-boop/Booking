import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/db";
import { and, eq } from "drizzle-orm";
import { newId } from "@/lib/ids";
import { logAudit } from "@/lib/audit";
import { localISODate } from "@/lib/date";

/**
 * Foreningsportalens "anmod om aflysning": en forening beder om at få en
 * sæsonbooking (hele resten af sæsonen, fra en dato, eller kun én dato) eller
 * en enkeltbooking aflyst. Intet aflyses her - der oprettes en anmodning som
 * personalet godkender/afviser under /anmodninger (se PATCH i
 * src/app/api/reschedule-requests/[id]/route.ts), og foreningen får besked.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    organizationId?: string;
    seasonGroupId?: string;
    bookingId?: string;
    scope?: "alt" | "fra_dato" | "enkelt";
    fromDate?: string;
    onlyDate?: string;
    extraEmail?: string;
    notes?: string;
  };
  const { organizationId, seasonGroupId, bookingId, scope } = body;

  if (!organizationId || (!seasonGroupId && !bookingId) || !scope) {
    return NextResponse.json({ error: "Vælg venligst hvad der skal aflyses" }, { status: 400 });
  }
  const [org] = await db.select().from(schema.organizations).where(eq(schema.organizations.id, organizationId));
  if (!org) return NextResponse.json({ error: "Forening ikke fundet" }, { status: 404 });
  if (org.status !== "godkendt") {
    return NextResponse.json({ error: "Jeres forening afventer stadig godkendelse" }, { status: 403 });
  }

  const today = localISODate();
  const candidates = await db
    .select()
    .from(schema.bookings)
    .where(
      seasonGroupId
        ? and(eq(schema.bookings.organizationId, organizationId), eq(schema.bookings.seasonGroupId, seasonGroupId))
        : and(eq(schema.bookings.organizationId, organizationId), eq(schema.bookings.id, bookingId!))
    );
  let affected = candidates
    .filter((b) => b.status !== "aflyst" && b.status !== "afvist" && b.startsAt.slice(0, 10) >= today)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));

  if (seasonGroupId) {
    if (scope === "fra_dato") {
      if (!body.fromDate) return NextResponse.json({ error: "Vælg fra hvilken dato der skal aflyses" }, { status: 400 });
      affected = affected.filter((b) => b.startsAt.slice(0, 10) >= body.fromDate!);
    } else if (scope === "enkelt") {
      if (!body.onlyDate) return NextResponse.json({ error: "Vælg hvilken dato der skal aflyses" }, { status: 400 });
      affected = affected.filter((b) => b.startsAt.slice(0, 10) === body.onlyDate);
    }
  }
  if (affected.length === 0) {
    return NextResponse.json({ error: "Der er ingen kommende bookinger at aflyse med det valg" }, { status: 400 });
  }

  // Undgå dobbelte anmodninger for præcis de samme bookinger.
  const key = affected.map((b) => b.id).sort().join(",");
  const pending = await db
    .select()
    .from(schema.rescheduleRequests)
    .where(and(eq(schema.rescheduleRequests.organizationId, organizationId), eq(schema.rescheduleRequests.status, "afventer")));
  if (pending.some((r) => r.kind === "aflysning" && [...r.conflictingBookingIds].sort().join(",") === key)) {
    return NextResponse.json({ error: "I har allerede sendt en anmodning om det samme - vi vender tilbage." }, { status: 409 });
  }

  const first = affected[0];
  const id = newId("resched");
  await db.insert(schema.rescheduleRequests).values({
    id,
    organizationId,
    facilityIds: [first.facilityId],
    startsAt: first.startsAt,
    endsAt: first.endsAt,
    extraEmail: body.extraEmail || null,
    notes: body.notes || null,
    conflictingBookingIds: affected.map((b) => b.id),
    status: "afventer",
    kind: "aflysning",
    cancelScope: seasonGroupId ? scope : "enkelt",
    seasonGroupId: seasonGroupId ?? null,
  });
  await logAudit(
    "reschedule_request",
    id,
    "oprettet",
    `Anmodning om aflysning af ${affected.length} booking(er) fra ${org.name} via foreningsportalen`,
    org.name
  );

  return NextResponse.json({ id, status: "afventer", count: affected.length }, { status: 201 });
}
