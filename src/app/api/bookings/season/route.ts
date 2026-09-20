import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/db";
import { eq } from "drizzle-orm";
import { newId } from "@/lib/ids";
import { logAudit } from "@/lib/audit";
import { findConflicts } from "@/lib/conflicts";
import { seasonConfirmationMessage } from "@/lib/ai/messages";
import { weeklyOccurrenceDates } from "@/lib/date";

/**
 * Opretter en sæsonbooking: én selvstændig booking-række pr. ugentlig
 * forekomst (samme mønster som når en sæsonmail godkendes i indbakken, se
 * approveLine i src/lib/inboxActions.ts), alle grupperet under samme
 * `seasonGroupId` og mærket med `recurrenceRule` - så de kan vises
 * farvekodet i kalenderen og senere aflyses samlet (se
 * /api/bookings/season/[seasonGroupId]).
 *
 * `startDate` er datoen for FØRSTE forekomst - ugedagen udledes af den, så
 * "hver tirsdag" fx opstår naturligt ved bare at vælge en tirsdag som
 * startdato. `until` er sidste dag sæsonen kan løbe til (inklusiv).
 */
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { facilityId, startDate, startTime, endTime, until, force } = body;

  if (!facilityId || !startDate || !startTime || !endTime || !until) {
    return NextResponse.json(
      { error: "facilityId, startDate, startTime, endTime og until er påkrævet" },
      { status: 400 }
    );
  }

  const weekday = new Date(`${startDate}T00:00:00`).getDay();
  const dates = weeklyOccurrenceDates(startDate, until, weekday);
  if (dates.length === 0) {
    return NextResponse.json(
      { error: "Slutdatoen ligger før startdatoen - der er ingen forekomster at oprette" },
      { status: 400 }
    );
  }

  // Tjek konflikt for ALLE forekomster først, så brugeren kan se dem samlet
  // på én gang i stedet for at støde ind i dem én uge ad gangen.
  const conflictsByDate: Record<string, Awaited<ReturnType<typeof findConflicts>>> = {};
  for (const date of dates) {
    const conflicts = await findConflicts(facilityId, `${date}T${startTime}:00`, `${date}T${endTime}:00`);
    if (conflicts.length > 0) conflictsByDate[date] = conflicts;
  }
  if (Object.keys(conflictsByDate).length > 0 && !force) {
    return NextResponse.json(
      { error: "konflikt", conflictsByDate, occurrenceCount: dates.length },
      { status: 409 }
    );
  }

  // Samme fallback-titel-logik som enkeltbookinger (se /api/bookings).
  let fallbackTitle = "Booking";
  if (!body.title && body.organizationId) {
    const [org] = await db.select().from(schema.organizations).where(eq(schema.organizations.id, body.organizationId));
    if (org?.name) fallbackTitle = org.name;
  }

  const seasonGroupId = newId("season");
  const recurrenceRule = { freq: "weekly" as const, weekday, until };
  const createdBookingIds: string[] = [];

  for (const date of dates) {
    const id = newId("book");
    await db.insert(schema.bookings).values({
      id,
      facilityId,
      organizationId: body.organizationId ?? null,
      title: body.title || fallbackTitle,
      contactName: body.contactName ?? null,
      contactEmail: body.contactEmail ?? null,
      contactPhone: body.contactPhone ?? null,
      startsAt: `${date}T${startTime}:00`,
      endsAt: `${date}T${endTime}:00`,
      status: body.status ?? "reserveret",
      seasonGroupId,
      recurrenceRule,
      notes: body.notes ?? null,
      source: body.source ?? "manuel",
      createdBy: body.createdBy ?? "Medarbejder",
    });
    createdBookingIds.push(id);
  }
  await logAudit(
    "booking",
    seasonGroupId,
    "saeson_oprettet",
    `${body.title || fallbackTitle}: ${dates.length} forekomster oprettet (${body.source ?? "manuel"})`,
    body.createdBy ?? undefined
  );

  // Én samlet bekræftelsesmail for hele sæsonen (ikke én pr. uge) hvis vi har
  // en kontaktmail - jf. samme mønster som ved enkeltbookinger i /api/bookings.
  if (body.contactEmail) {
    const [facility] = await db.select().from(schema.facilities).where(eq(schema.facilities.id, facilityId));
    const message = seasonConfirmationMessage({
      facilityName: facility?.name ?? "faciliteten",
      weekday,
      startTime,
      endTime,
      until,
      occurrenceCount: dates.length,
      recipientName: body.contactName ?? undefined,
    });
    await db.insert(schema.notificationLog).values({
      id: newId("notif"),
      bookingId: createdBookingIds[0],
      type: "bekraeftelse",
      recipient: body.contactEmail,
      subject: "Bekræftelse af jeres sæsonbooking",
      body: message,
    });
  }

  return NextResponse.json(
    { seasonGroupId, createdBookingIds, overriddenConflicts: force ? conflictsByDate : {} },
    { status: 201 }
  );
}
