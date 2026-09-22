import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/db";
import { eq } from "drizzle-orm";
import { logAudit } from "@/lib/audit";
import { findConflicts } from "@/lib/conflicts";
import { seasonMovedMessage } from "@/lib/ai/messages";
import { resolveNotificationRecipients } from "@/lib/notifications";
import { maybeCreateAccessCode } from "@/lib/accessCodes";
import { addDays, localISODate } from "@/lib/date";
import { newId } from "@/lib/ids";

type Booking = typeof schema.bookings.$inferSelect;

/**
 * Flytter HELE resten af en sæson på én gang - dvs. den forekomst brugeren
 * trak/redigerede (`anchorBookingId`) OG alle senere forekomster i samme
 * `seasonGroupId` (allerede overståede/aflyste forekomster røres ikke) -
 * til et nyt tidspunkt (samme forskydning i dage/klokkeslæt som anker-
 * forekomsten fik) og/eller en ny facilitet. Modstykket til den almindelige
 * enkelt-booking-flytning i /api/bookings/[id], som Martin bad om et
 * eksplicit valg mellem ("flyt kun denne booking" vs. "flyt hele sæsonen").
 *
 * Body: { anchorBookingId, facilityId?, startsAt?, endsAt?, force? } - kun
 * de felter der reelt ændres for anker-forekomsten skal sendes, resten
 * beholder ankerets nuværende værdi (samme mønster som PATCH /api/bookings/[id]).
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ seasonGroupId: string }> }) {
  const { seasonGroupId } = await params;
  const body = await req.json();
  const { anchorBookingId, force } = body;

  if (!anchorBookingId) {
    return NextResponse.json({ error: "anchorBookingId er påkrævet" }, { status: 400 });
  }

  const [anchor] = await db.select().from(schema.bookings).where(eq(schema.bookings.id, anchorBookingId));
  if (!anchor || anchor.seasonGroupId !== seasonGroupId) {
    return NextResponse.json({ error: "Ikke fundet" }, { status: 404 });
  }

  const nextFacilityId: string = body.facilityId ?? anchor.facilityId;
  const nextStartsAt: string = body.startsAt ?? anchor.startsAt;
  const nextEndsAt: string = body.endsAt ?? anchor.endsAt;

  const origDate = anchor.startsAt.slice(0, 10);
  const newDate = nextStartsAt.slice(0, 10);
  const newStartTime = nextStartsAt.slice(11, 16);
  const newEndTime = nextEndsAt.slice(11, 16);
  const dayDelta = Math.round(
    (new Date(`${newDate}T00:00:00`).getTime() - new Date(`${origDate}T00:00:00`).getTime()) / 86400000
  );
  const newWeekday = new Date(`${newDate}T00:00:00`).getDay();

  // "Resten af sæsonen" = denne forekomst og alle senere, aktive forekomster
  // i samme sæsongruppe - allerede overståede/aflyste forekomster ændres
  // ikke, så historikken forbliver intakt (samme afgrænsning som den
  // eksisterende samlede sæsonaflysning i /api/bookings/season/[seasonGroupId]).
  const rows = await db.select().from(schema.bookings).where(eq(schema.bookings.seasonGroupId, seasonGroupId));
  const toMove = rows
    .filter((b) => b.status !== "aflyst" && b.startsAt.slice(0, 10) >= origDate)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));

  if (toMove.length === 0) {
    return NextResponse.json({ error: "Ingen forekomster at flytte" }, { status: 400 });
  }

  const movingIds = new Set(toMove.map((b) => b.id));

  function shiftedTimes(booking: Booking): { startsAt: string; endsAt: string } {
    const shiftedDate = localISODate(addDays(new Date(`${booking.startsAt.slice(0, 10)}T00:00:00`), dayDelta));
    return {
      startsAt: `${shiftedDate}T${newStartTime}:00`,
      endsAt: `${shiftedDate}T${newEndTime}:00`,
    };
  }

  // Tjek konflikt for ALLE forekomster først (samme fremgangsmåde som ved
  // oprettelse af en ny sæson, se /api/bookings/season), så brugeren ser dem
  // samlet i stedet for én ad gangen. Konflikter mod andre forekomster i
  // samme flytning (som stadig ligger på deres GAMLE tidspunkt i databasen
  // her) er ikke reelle konflikter og filtreres fra.
  const conflictsByDate: Record<string, Booking[]> = {};
  for (const booking of toMove) {
    const { startsAt, endsAt } = shiftedTimes(booking);
    const conflicts = (await findConflicts(nextFacilityId, startsAt, endsAt, booking.id)).filter(
      (c) => !movingIds.has(c.id)
    );
    if (conflicts.length > 0) conflictsByDate[startsAt.slice(0, 10)] = conflicts;
  }
  if (Object.keys(conflictsByDate).length > 0 && !force) {
    return NextResponse.json(
      { error: "konflikt", conflictsByDate, occurrenceCount: toMove.length },
      { status: 409 }
    );
  }

  const allFacilities = await db.select().from(schema.facilities);
  const nextFacility = allFacilities.find((f) => f.id === nextFacilityId);

  for (const booking of toMove) {
    const { startsAt, endsAt } = shiftedTimes(booking);
    const nextRecurrenceRule = booking.recurrenceRule
      ? { ...booking.recurrenceRule, weekday: newWeekday }
      : booking.recurrenceRule;

    await db
      .update(schema.bookings)
      .set({
        facilityId: nextFacilityId,
        startsAt,
        endsAt,
        recurrenceRule: nextRecurrenceRule,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schema.bookings.id, booking.id));

    // Samme nulstilling/genberegning af adgangskode som ved en almindelig
    // enkelt-booking-flytning (se PATCH /api/bookings/[id]) - i praksis
    // sjældent relevant her, da sæsonbookinger næsten altid er
    // foreningsbookinger, og foreninger aldrig får en kode.
    await db.delete(schema.accessCodes).where(eq(schema.accessCodes.bookingId, booking.id));
    await db.update(schema.bookings).set({ accessCode: null }).where(eq(schema.bookings.id, booking.id));
    if (nextFacility) {
      await maybeCreateAccessCode({
        bookingId: booking.id,
        organizationId: booking.organizationId,
        facility: nextFacility,
        allFacilities,
        startsAt,
        endsAt,
      });
    }

    await logAudit("booking", booking.id, "flyttet", "Flyttet som del af hele sæsonen");
  }

  // Én samlet "sæson flyttet"-mail (ikke én pr. forekomst) - jf. samme
  // mønster som ved samlet sæsonoprettelse/-aflysning.
  const recipients = await resolveNotificationRecipients(anchor);
  if (recipients.length > 0) {
    const message = seasonMovedMessage({
      facilityName: nextFacility?.name ?? "faciliteten",
      weekday: newWeekday,
      startTime: newStartTime,
      endTime: newEndTime,
      movedFrom: origDate,
      recipientName: anchor.contactName ?? undefined,
    });
    for (const recipient of recipients) {
      await db.insert(schema.notificationLog).values({
        id: newId("notif"),
        bookingId: anchor.id,
        type: "aendring",
        recipient,
        subject: "Jeres sæsonbooking er flyttet",
        body: message,
      });
    }
  }

  return NextResponse.json({
    movedBookingIds: toMove.map((b) => b.id),
    overriddenConflicts: force ? conflictsByDate : {},
  });
}
