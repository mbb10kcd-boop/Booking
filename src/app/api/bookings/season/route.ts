import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/db";
import { eq } from "drizzle-orm";
import { newId } from "@/lib/ids";
import { logAudit } from "@/lib/audit";
import { conflictsAmong, loadActiveBookingsBetween, relatedFacilityIds, warningsAmong } from "@/lib/conflicts";
import { getAllFacilities } from "@/lib/facilities";
import { seasonConfirmationMessage } from "@/lib/ai/messages";
import { weeklyOccurrenceDates } from "@/lib/date";
import { sendNotification } from "@/lib/mailer";

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
  // Performance: faciliteter og relevante bookinger hentes ÉN gang for hele
  // sæsonen, og alle forekomster tjekkes i hukommelsen - i stedet for to
  // databasekald (der hver hentede ALLE bookinger) pr. uge.
  const facilities = await getAllFacilities();
  const seasonRows = await loadActiveBookingsBetween(
    `${dates[0]}T${startTime}:00`,
    `${dates[dates.length - 1]}T${endTime}:00`,
    relatedFacilityIds(facilityId, facilities)
  );
  type BookingRow = (typeof seasonRows)[number];
  const conflictsByDate: Record<string, BookingRow[]> = {};
  for (const date of dates) {
    const conflicts = conflictsAmong(seasonRows, facilities, facilityId, `${date}T${startTime}:00`, `${date}T${endTime}:00`);
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

  const rowsToInsert = dates.map((date) => {
    const id = newId("book");
    createdBookingIds.push(id);
    return {
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
      important: body.important ?? false,
      notes: body.notes ?? null,
      source: body.source ?? "manuel",
      createdBy: body.createdBy ?? "Medarbejder",
    };
  });
  // Indsæt i klumper (ét databasekald pr. klump i stedet for ét pr. uge).
  for (let i = 0; i < rowsToInsert.length; i += 25) {
    await db.insert(schema.bookings).values(rowsToInsert.slice(i, i + 25));
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
    await sendNotification({
      id: newId("notif"),
      bookingId: createdBookingIds[0],
      type: "bekraeftelse",
      recipient: body.contactEmail,
      subject: "Bekræftelse af jeres sæsonbooking",
      body: message,
    });
  }

  // Løst koblede faciliteter (fx klatrevæg/opvisningshal) blokerer ikke,
  // men flages pr. dato som en bemærkning til den der booker.
  const warningsByDate: Record<string, BookingRow[]> = {};
  for (const date of dates) {
    const warnings = warningsAmong(seasonRows, facilities, facilityId, `${date}T${startTime}:00`, `${date}T${endTime}:00`);
    if (warnings.length > 0) warningsByDate[date] = warnings;
  }

  return NextResponse.json(
    {
      seasonGroupId,
      createdBookingIds,
      overriddenConflicts: force ? conflictsByDate : {},
      warningsByDate,
    },
    { status: 201 }
  );
}
