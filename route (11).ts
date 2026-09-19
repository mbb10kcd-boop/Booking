import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/db";
import { newId } from "@/lib/ids";
import { logAudit } from "@/lib/audit";
import { parseBookingMail } from "@/lib/ai/mailParser";
import { getAllFacilities } from "@/lib/facilities";
import { findConflicts } from "@/lib/conflicts";
import { desc, eq, like, or } from "drizzle-orm";
import { localISODate } from "@/lib/date";

/** Udregner alle datoer for en ugentlig gentagelse mellem periodStart og periodEnd for en given ugedag */
function weeklyOccurrences(periodStart: string, periodEnd: string, weekday: number): string[] {
  const dates: string[] = [];
  const cur = new Date(periodStart + "T00:00:00");
  const end = new Date(periodEnd + "T00:00:00");
  // Ryk frem til første forekomst af weekday
  while (cur.getDay() !== weekday) cur.setDate(cur.getDate() + 1);
  while (cur.getTime() <= end.getTime()) {
    dates.push(localISODate(cur));
    cur.setDate(cur.getDate() + 7);
  }
  return dates;
}

export async function GET() {
  const requests = await db.select().from(schema.bookingRequests).orderBy(desc(schema.bookingRequests.createdAt));
  const allLines = await db.select().from(schema.bookingRequestLines);
  const withLines = requests.map((r) => ({
    ...r,
    lines: allLines.filter((l) => l.requestId === r.id),
  }));
  return NextResponse.json(withLines);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { rawText, sourceEmail } = body;
  if (!rawText) return NextResponse.json({ error: "rawText er påkrævet" }, { status: 400 });

  const facilities = await getAllFacilities();
  const parsed = parseBookingMail(rawText, facilities);

  // Forsøg at genkende foreningen på navn eller kontakt-mail
  let matchedOrganizationId: string | null = null;
  if (parsed.contactEmail) {
    const [byEmail] = await db
      .select()
      .from(schema.organizations)
      .where(eq(schema.organizations.contactEmail, parsed.contactEmail));
    if (byEmail) matchedOrganizationId = byEmail.id;
  }
  if (!matchedOrganizationId && parsed.organizationName) {
    const [byName] = await db
      .select()
      .from(schema.organizations)
      .where(like(schema.organizations.name, `%${parsed.organizationName}%`));
    if (byName) matchedOrganizationId = byName.id;
  }

  const requestId = newId("req");
  await db.insert(schema.bookingRequests).values({
    id: requestId,
    rawText,
    sourceEmail: sourceEmail ?? parsed.contactEmail ?? null,
    type: parsed.type,
    parsedOrganizationName: parsed.organizationName ?? null,
    parsedContactName: parsed.contactName ?? null,
    parsedContactEmail: parsed.contactEmail ?? null,
    parsedContactPhone: parsed.contactPhone ?? null,
    matchedOrganizationId,
    aiSummary: parsed.summary,
    status: "ny",
  });

  const createdLines = [];
  for (const line of parsed.lines) {
    if (line.periodStart && line.periodEnd && line.weekday !== undefined) {
      // Sæsonbooking: én linje repræsenterer hele det gentagne mønster.
      // Vi tjekker konflikt for FØRSTE forekomst som repræsentant, men gemmer
      // hele mønsteret så alle datoer oprettes ved godkendelse.
      const occurrences = weeklyOccurrences(line.periodStart, line.periodEnd, line.weekday);
      const firstDate = occurrences[0] ?? line.periodStart;
      const startsAt = `${firstDate}T${line.startTime}:00`;
      const endsAt = `${firstDate}T${line.endTime}:00`;
      let status: "ledig" | "konflikt" = "ledig";
      let conflictBookingId: string | null = null;
      if (line.facilityId) {
        const conflicts = await findConflicts(line.facilityId, startsAt, endsAt);
        if (conflicts.length > 0) {
          status = "konflikt";
          conflictBookingId = conflicts[0].id;
        }
      } else {
        status = "konflikt"; // ukendt facilitet skal også gennemgås manuelt
      }
      const lineId = newId("line");
      await db.insert(schema.bookingRequestLines).values({
        id: lineId,
        requestId,
        weekdayText: line.weekdayText ?? null,
        weekday: line.weekday,
        startTime: line.startTime,
        endTime: line.endTime,
        periodStart: line.periodStart,
        periodEnd: line.periodEnd,
        facilityText: line.facilityText ?? null,
        facilityId: line.facilityId ?? null,
        status,
        conflictBookingId,
      });
      createdLines.push(lineId);
    } else {
      // Enkeltbooking
      const date = line.singleDate;
      let status: "ledig" | "konflikt" = "ledig";
      let conflictBookingId: string | null = null;
      let startsAt: string | null = null;
      let endsAt: string | null = null;
      if (date) {
        startsAt = `${date}T${line.startTime}:00`;
        endsAt = `${date}T${line.endTime}:00`;
        if (line.facilityId) {
          const conflicts = await findConflicts(line.facilityId, startsAt, endsAt);
          if (conflicts.length > 0) {
            status = "konflikt";
            conflictBookingId = conflicts[0].id;
          }
        } else {
          status = "konflikt";
        }
      } else {
        status = "konflikt"; // mangler dato -> kræver manuel gennemgang
      }
      const lineId = newId("line");
      await db.insert(schema.bookingRequestLines).values({
        id: lineId,
        requestId,
        weekdayText: line.weekdayText ?? null,
        weekday: line.weekday ?? null,
        startTime: line.startTime,
        endTime: line.endTime,
        singleDate: date ?? null,
        facilityText: line.facilityText ?? null,
        facilityId: line.facilityId ?? null,
        status,
        conflictBookingId,
      });
      createdLines.push(lineId);
    }
  }

  await logAudit("booking_request", requestId, "modtaget", `${createdLines.length} linje(r) fortolket fra mail`);

  const lines = await db
    .select()
    .from(schema.bookingRequestLines)
    .where(eq(schema.bookingRequestLines.requestId, requestId));

  const [request] = await db.select().from(schema.bookingRequests).where(eq(schema.bookingRequests.id, requestId));

  return NextResponse.json({ ...request, lines }, { status: 201 });
}
