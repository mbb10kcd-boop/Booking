import { db, schema } from "@/db";
import { eq } from "drizzle-orm";
import { newId } from "./ids";
import { logAudit } from "./audit";
import { findConflicts } from "./conflicts";
import { displacedBookingMessage, rejectionMessage } from "./ai/messages";
import { localISODate } from "./date";

type RequestLine = typeof schema.bookingRequestLines.$inferSelect;
type BookingRequestRow = typeof schema.bookingRequests.$inferSelect;

function weeklyOccurrences(periodStart: string, periodEnd: string, weekday: number): string[] {
  const dates: string[] = [];
  const cur = new Date(periodStart + "T00:00:00");
  const end = new Date(periodEnd + "T00:00:00");
  while (cur.getDay() !== weekday) cur.setDate(cur.getDate() + 1);
  while (cur.getTime() <= end.getTime()) {
    dates.push(localISODate(cur));
    cur.setDate(cur.getDate() + 7);
  }
  return dates;
}

async function getLineAndRequest(lineId: string): Promise<{ line: RequestLine; request: BookingRequestRow }> {
  const [line] = await db.select().from(schema.bookingRequestLines).where(eq(schema.bookingRequestLines.id, lineId));
  if (!line) throw new Error("Linje ikke fundet");
  const [request] = await db.select().from(schema.bookingRequests).where(eq(schema.bookingRequests.id, line.requestId));
  if (!request) throw new Error("Forespørgsel ikke fundet");
  return { line, request };
}

interface ApproveResult {
  createdBookingIds: string[];
  skippedDates: string[];
  cancelledExistingBookingIds: string[];
}

/**
 * Godkender en linje. Hvis linjen er sæsonbooking, oprettes en booking pr.
 * ugentlig forekomst i perioden. `overtake=true` betyder at eksisterende
 * konfliktende bookinger må aflyses (kræver eksplicit medarbejder-klik i UI).
 */
export async function approveLine(lineId: string, overtake: boolean, actorName = "Medarbejder"): Promise<ApproveResult> {
  const { line, request } = await getLineAndRequest(lineId);
  if (!line.facilityId) throw new Error("Linjen mangler en matchet facilitet og kan ikke godkendes automatisk");

  const result: ApproveResult = { createdBookingIds: [], skippedDates: [], cancelledExistingBookingIds: [] };
  const title = request.parsedOrganizationName ?? request.parsedContactName ?? "Booking";
  const seasonGroupId = line.periodStart ? newId("season") : null;

  const dates =
    line.periodStart && line.periodEnd && line.weekday !== null && line.weekday !== undefined
      ? weeklyOccurrences(line.periodStart, line.periodEnd, line.weekday)
      : line.singleDate
      ? [line.singleDate]
      : [];

  for (const date of dates) {
    const startsAt = `${date}T${line.startTime}:00`;
    const endsAt = `${date}T${line.endTime}:00`;
    const conflicts = await findConflicts(line.facilityId, startsAt, endsAt);

    if (conflicts.length > 0) {
      if (!overtake) {
        result.skippedDates.push(date);
        continue;
      }
      // Overtag: aflys eksisterende og generer besked
      for (const existing of conflicts) {
        await db.update(schema.bookings).set({ status: "aflyst" }).where(eq(schema.bookings.id, existing.id));
        result.cancelledExistingBookingIds.push(existing.id);
        const [facility] = await db.select().from(schema.facilities).where(eq(schema.facilities.id, existing.facilityId));
        const message = displacedBookingMessage({
          organizationName: existing.title,
          facilityName: facility?.name ?? "faciliteten",
          startsAt: existing.startsAt,
          endsAt: existing.endsAt,
        });
        let recipient = existing.contactEmail;
        if (!recipient && existing.organizationId) {
          const [org] = await db.select().from(schema.organizations).where(eq(schema.organizations.id, existing.organizationId));
          recipient = org?.contactEmail ?? null;
        }
        await db.insert(schema.notificationLog).values({
          id: newId("notif"),
          bookingId: existing.id,
          type: "aendring",
          recipient: recipient ?? "ukendt",
          subject: "Ændring af jeres booking",
          body: message,
        });
        await db.insert(schema.conflictLogs).values({
          id: newId("conflict"),
          requestLineId: line.id,
          existingBookingId: existing.id,
          resolution: "overtaget",
          generatedMessage: message,
          resolvedBy: actorName,
          resolvedAt: new Date().toISOString(),
        });
        await logAudit("booking", existing.id, "aflyst_pga_overtagelse", `Overtaget af ny booking fra ${title}`, actorName);
      }
    }

    const bookingId = newId("book");
    await db.insert(schema.bookings).values({
      id: bookingId,
      facilityId: line.facilityId,
      organizationId: request.matchedOrganizationId,
      title,
      contactName: request.parsedContactName,
      contactEmail: request.parsedContactEmail,
      contactPhone: request.parsedContactPhone,
      startsAt,
      endsAt,
      status: "bekraeftet",
      seasonGroupId,
      recurrenceRule: seasonGroupId && line.weekday !== null ? { freq: "weekly", weekday: line.weekday!, until: line.periodEnd! } : null,
      source: "mail",
      createdBy: actorName,
    });
    result.createdBookingIds.push(bookingId);
    await logAudit("booking", bookingId, "oprettet", `Oprettet fra bookingforespørgsel (${request.type})`, actorName);
  }

  const newStatus = result.skippedDates.length > 0 && !overtake ? "konflikt" : "godkendt";
  await db
    .update(schema.bookingRequestLines)
    .set({ status: newStatus, resultingBookingId: result.createdBookingIds[0] ?? null })
    .where(eq(schema.bookingRequestLines.id, lineId));

  await maybeCloseRequest(request.id);

  return result;
}

export async function rejectLine(lineId: string, actorName = "Medarbejder"): Promise<{ message: string }> {
  const { line, request } = await getLineAndRequest(lineId);
  await db.update(schema.bookingRequestLines).set({ status: "afvist" }).where(eq(schema.bookingRequestLines.id, lineId));

  const [facility] = line.facilityId
    ? await db.select().from(schema.facilities).where(eq(schema.facilities.id, line.facilityId))
    : [null];

  const startsAt = line.singleDate ? `${line.singleDate}T${line.startTime}:00` : `${line.periodStart}T${line.startTime}:00`;
  const endsAt = line.singleDate ? `${line.singleDate}T${line.endTime}:00` : `${line.periodStart}T${line.endTime}:00`;

  const message = rejectionMessage({
    facilityName: facility?.name ?? line.facilityText ?? "faciliteten",
    startsAt,
    endsAt,
    recipientName: request.parsedContactName ?? undefined,
  });

  await db.insert(schema.notificationLog).values({
    id: newId("notif"),
    type: "afvisning",
    recipient: request.parsedContactEmail ?? "ukendt",
    subject: "Svar på jeres bookingforespørgsel",
    body: message,
  });

  await logAudit("booking_request_line", lineId, "afvist", message, actorName);
  await maybeCloseRequest(request.id);

  return { message };
}

export async function editLineProposal(
  lineId: string,
  updates: { facilityId?: string; startTime?: string; endTime?: string; singleDate?: string }
) {
  const { line } = await getLineAndRequest(lineId);
  const merged = { ...line, ...updates };
  let status: "ledig" | "konflikt" = "ledig";
  let conflictBookingId: string | null = null;
  // Find en repræsentativ dato at konfliktteste imod: den enkelte dato for en
  // enkeltbooking, eller første forekomst af ugedagen for en sæsonbooking
  // (samme fremgangsmåde som ved den oprindelige mailfortolkning i
  // /api/inbox). Den fulde sæson konfliktcheckes alligevel linje for linje
  // ved selve godkendelsen (se approveLine), så dette er kun en hurtig
  // forhåndsindikation til medarbejderen.
  let representativeDate: string | undefined = merged.singleDate ?? undefined;
  if (!representativeDate && merged.periodStart && merged.weekday !== null && merged.weekday !== undefined) {
    const cur = new Date(merged.periodStart + "T00:00:00");
    while (cur.getDay() !== merged.weekday) cur.setDate(cur.getDate() + 1);
    representativeDate = localISODate(cur);
  }
  if (merged.facilityId && representativeDate) {
    const startsAt = `${representativeDate}T${merged.startTime}:00`;
    const endsAt = `${representativeDate}T${merged.endTime}:00`;
    const conflicts = await findConflicts(merged.facilityId, startsAt, endsAt);
    if (conflicts.length > 0) {
      status = "konflikt";
      conflictBookingId = conflicts[0].id;
    }
  } else if (!merged.facilityId) {
    status = "konflikt";
  }
  await db
    .update(schema.bookingRequestLines)
    .set({ ...updates, status, conflictBookingId })
    .where(eq(schema.bookingRequestLines.id, lineId));
  const [updated] = await db.select().from(schema.bookingRequestLines).where(eq(schema.bookingRequestLines.id, lineId));
  return updated;
}

async function maybeCloseRequest(requestId: string) {
  const lines = await db.select().from(schema.bookingRequestLines).where(eq(schema.bookingRequestLines.requestId, requestId));
  const allDone = lines.every((l) => ["godkendt", "afvist", "flyttet"].includes(l.status));
  await db
    .update(schema.bookingRequests)
    .set({ status: allDone ? "afsluttet" : "behandlet" })
    .where(eq(schema.bookingRequests.id, requestId));
}
