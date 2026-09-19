/* eslint-disable @typescript-eslint/no-explicit-any */
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import path from "path";
import fs from "fs";
import { randomUUID } from "crypto";
import * as schema from "./schema";
import { parseBookingMail } from "../lib/ai/mailParser";

const dbPath = process.env.DATABASE_PATH || path.join(process.cwd(), "data", "grenaa.db");
const dir = path.dirname(dbPath);
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
const sqlite = new Database(dbPath);
const db = drizzle(sqlite, { schema });

function id(prefix: string) {
  return `${prefix}_${randomUUID()}`;
}

function nextWeekday(weekday: number, from = new Date()): Date {
  const d = new Date(from);
  d.setHours(0, 0, 0, 0);
  const diff = (weekday - d.getDay() + 7) % 7;
  d.setDate(d.getDate() + diff);
  return d;
}

function isoDate(d: Date) {
  // Lokal kalenderdato (IKKE toISOString, som konverterer til UTC og kan
  // forskyde datoen en dag pga. tidszonen - se src/lib/date.ts)
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

async function main() {
  console.log("Nulstiller eksisterende data...");
  sqlite.exec(`
    DELETE FROM notification_log;
    DELETE FROM conflict_logs;
    DELETE FROM booking_request_lines;
    DELETE FROM booking_requests;
    DELETE FROM access_codes;
    DELETE FROM payments;
    DELETE FROM audit_log;
    DELETE FROM bookings;
    DELETE FROM info_screens;
    DELETE FROM organizations;
    DELETE FROM facilities;
    DELETE FROM users;
  `);

  // -------------------------------------------------------------------
  // Faciliteter
  // -------------------------------------------------------------------
  const hal1 = { id: id("fac"), name: "Hal 1", capacity: 200, pricePerHour: 0, color: "#2563eb", sortOrder: 1 };
  const hal1a = { id: id("fac"), name: "Hal 1A", parentId: hal1.id, capacity: 80, color: "#3b82f6", sortOrder: 2 };
  const hal1b = { id: id("fac"), name: "Hal 1B", parentId: hal1.id, capacity: 80, color: "#3b82f6", sortOrder: 3 };
  const hal2 = { id: id("fac"), name: "Hal 2", capacity: 150, color: "#059669", sortOrder: 4 };
  const sal2 = { id: id("fac"), name: "Sal 2", capacity: 40, color: "#7c3aed", sortOrder: 5 };
  const badminton = { id: id("fac"), name: "Badmintonbaner", capacity: 16, color: "#ea580c", sortOrder: 6 };
  const baner = [1, 2, 3, 4].map((n) => ({
    id: id("fac"),
    name: `Bane ${n}`,
    parentId: badminton.id,
    capacity: 4,
    pricePerHour: 120,
    requiresPayment: true,
    color: "#f97316",
    sortOrder: 6 + n,
  }));
  const moedelokale = { id: id("fac"), name: "Mødelokale 1", capacity: 12, color: "#64748b", sortOrder: 11 };

  const allFacilities = [hal1, hal1a, hal1b, hal2, sal2, badminton, ...baner, moedelokale];
  for (const f of allFacilities) {
    await db.insert(schema.facilities).values({
      id: f.id,
      name: f.name,
      parentId: (f as any).parentId ?? null,
      capacity: f.capacity,
      pricePerHour: (f as any).pricePerHour ?? 0,
      requiresPayment: (f as any).requiresPayment ?? false,
      color: f.color,
      sortOrder: f.sortOrder,
      bookingTypes: [],
    });
  }
  console.log(`Oprettede ${allFacilities.length} faciliteter/underressourcer.`);

  // -------------------------------------------------------------------
  // Foreninger
  // -------------------------------------------------------------------
  const gifGymnastik = {
    id: id("org"),
    name: "GIF Gymnastik",
    cvr: "12345678",
    contactName: "Lise Andersen",
    contactEmail: "lise@gifgymnastik.dk",
    contactPhone: "23456789",
    address: "Idrætsvej 1, 8500 Grenaa",
  };
  const gifHaandbold = {
    id: id("org"),
    name: "GIF Håndbold",
    cvr: "87654321",
    contactName: "Peter Holm",
    contactEmail: "peter@gifhaandbold.dk",
    contactPhone: "30405060",
    address: "Idrætsvej 1, 8500 Grenaa",
  };
  for (const org of [gifGymnastik, gifHaandbold]) {
    await db.insert(schema.organizations).values(org);
  }
  console.log("Oprettede foreninger.");

  // -------------------------------------------------------------------
  // Eksisterende bookinger - dagens program (matcher pedel/infoskærm-eksempel)
  // -------------------------------------------------------------------
  const today = new Date();
  const todayIso = isoDate(today);

  async function addBooking(b: {
    facilityId: string;
    title: string;
    startsAt: string;
    endsAt: string;
    organizationId?: string;
    status?: any;
    seasonGroupId?: string;
    recurrenceRule?: any;
    source?: any;
  }) {
    const bookingId = id("book");
    await db.insert(schema.bookings).values({
      id: bookingId,
      facilityId: b.facilityId,
      organizationId: b.organizationId ?? null,
      title: b.title,
      startsAt: b.startsAt,
      endsAt: b.endsAt,
      status: b.status ?? "bekraeftet",
      seasonGroupId: b.seasonGroupId ?? null,
      recurrenceRule: b.recurrenceRule ?? null,
      source: b.source ?? "manuel",
      createdBy: "Martin",
    });
    return bookingId;
  }

  await addBooking({
    facilityId: badminton.id,
    title: "Motionsbadminton - 4 baner",
    startsAt: `${todayIso}T08:00:00`,
    endsAt: `${todayIso}T09:30:00`,
  });
  await addBooking({
    facilityId: hal1.id,
    title: "Skolearrangement",
    startsAt: `${todayIso}T10:00:00`,
    endsAt: `${todayIso}T12:00:00`,
  });
  await addBooking({
    facilityId: hal2.id,
    title: "GIF Håndbold",
    organizationId: gifHaandbold.id,
    startsAt: `${todayIso}T14:00:00`,
    endsAt: `${todayIso}T16:00:00`,
  });
  await addBooking({
    facilityId: hal1.id,
    title: "GIF Gymnastik",
    organizationId: gifGymnastik.id,
    startsAt: `${todayIso}T18:00:00`,
    endsAt: `${todayIso}T20:00:00`,
  });

  // -------------------------------------------------------------------
  // Eksisterende sæsonbooking: GIF Håndbold, tirsdage 17-19 i Hal 1
  // (skaber en KONFLIKT når sæsonmailen fra GIF Gymnastik fortolkes nedenfor)
  // -------------------------------------------------------------------
  const seasonStart = new Date(today.getFullYear(), 8, 1); // 1. september i indeværende år
  if (seasonStart.getTime() > today.getTime() + 1000 * 3600 * 24 * 200) {
    seasonStart.setFullYear(seasonStart.getFullYear() - 1);
  }
  const seasonEnd = new Date(seasonStart.getFullYear() + 1, 3, 30); // 30. april året efter
  const seasonGroupId = id("season");
  let cursor = nextWeekday(2, seasonStart); // tirsdag
  let count = 0;
  while (cursor.getTime() <= seasonEnd.getTime() && count < 30) {
    await addBooking({
      facilityId: hal1.id,
      title: "GIF Håndbold - sæsontræning",
      organizationId: gifHaandbold.id,
      startsAt: `${isoDate(cursor)}T17:00:00`,
      endsAt: `${isoDate(cursor)}T19:00:00`,
      seasonGroupId,
      recurrenceRule: { freq: "weekly", weekday: 2, until: isoDate(seasonEnd) },
      source: "saesonimport",
    });
    cursor = new Date(cursor);
    cursor.setDate(cursor.getDate() + 7);
    count++;
  }
  console.log(`Oprettede eksisterende sæsonbooking for GIF Håndbold (${count} forekomster).`);

  // -------------------------------------------------------------------
  // Bookingindbakke: to realistiske indkomne mails, fortolket automatisk
  // -------------------------------------------------------------------
  const facilitiesForParsing = allFacilities.map((f) => ({
    ...f,
    description: null,
    parentId: (f as any).parentId ?? null,
    openingHours: null,
    pricePerHour: (f as any).pricePerHour ?? 0,
    requiresPayment: (f as any).requiresPayment ?? false,
    bookingTypes: [],
    restrictions: null,
    archived: false,
    createdAt: null,
  })) as any;

  const seasonMail = `GIF Gymnastik ønsker følgende sæsonbookinger for den kommende sæson:

Mandag 16.00-18.00 i Hal 1
Tirsdag 17.00-19.00 i Hal 1
Onsdag 18.00-20.00 i Hal 2

Periode: ${String(seasonStart.getDate()).padStart(2, "0")}/${String(seasonStart.getMonth() + 1).padStart(2, "0")}-${String(seasonEnd.getDate()).padStart(2, "0")}/${String(seasonEnd.getMonth() + 1).padStart(2, "0")}

Mvh
Lise Andersen
lise@gifgymnastik.dk
23456789`;

  // Bruger en facilitet uden eksisterende bookinger i dag (Sal 2), så denne
  // demo-mail pålideligt viser "ledig" uanset hvilken ugedag scriptet køres på
  // (undgår at kollidere med dagens eksempelprogram nedenfor).
  const singleMailFree = `Hej

Kan vi leje Sal 2 lørdag fra kl. 14-16?

Mvh
Anders Jensen
anders.jensen@gmail.com
40506070`;

  async function ingestMail(rawText: string, sourceEmail?: string) {
    const parsed = parseBookingMail(rawText, facilitiesForParsing);
    const requestId = id("req");

    let matchedOrganizationId: string | null = null;
    if (parsed.contactEmail) {
      const match = [gifGymnastik, gifHaandbold].find((o) => o.contactEmail === parsed.contactEmail);
      if (match) matchedOrganizationId = match.id;
    }

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

    for (const line of parsed.lines) {
      let status: "ledig" | "konflikt" = "ledig";
      let conflictBookingId: string | null = null;

      if (line.facilityId) {
        const startsAt = line.periodStart
          ? `${isoDate(nextWeekday(line.weekday!, seasonStart))}T${line.startTime}:00`
          : `${line.singleDate}T${line.startTime}:00`;
        const endsAt = line.periodStart
          ? `${isoDate(nextWeekday(line.weekday!, seasonStart))}T${line.endTime}:00`
          : `${line.singleDate}T${line.endTime}:00`;

        const allBookings = await db.select().from(schema.bookings);
        const overlap = allBookings.some(
          (b) =>
            b.facilityId === line.facilityId &&
            b.status !== "aflyst" &&
            b.status !== "afvist" &&
            startsAt < b.endsAt &&
            b.startsAt < endsAt
        );
        if (overlap) {
          status = "konflikt";
          const conflictBooking = allBookings.find(
            (b) =>
              b.facilityId === line.facilityId &&
              b.status !== "aflyst" &&
              b.status !== "afvist" &&
              startsAt < b.endsAt &&
              b.startsAt < endsAt
          );
          conflictBookingId = conflictBooking?.id ?? null;
        }
      } else {
        status = "konflikt";
      }

      await db.insert(schema.bookingRequestLines).values({
        id: id("line"),
        requestId,
        weekdayText: line.weekdayText ?? null,
        weekday: line.weekday ?? null,
        startTime: line.startTime,
        endTime: line.endTime,
        singleDate: line.singleDate ?? null,
        periodStart: line.periodStart ?? null,
        periodEnd: line.periodEnd ?? null,
        facilityText: line.facilityText ?? null,
        facilityId: line.facilityId ?? null,
        status,
        conflictBookingId,
      });
    }
    return requestId;
  }

  await ingestMail(seasonMail);
  await ingestMail(singleMailFree);
  console.log("Oprettede 2 indkomne bookingforespørgsler i indbakken (1 sæson, 1 enkelt).");

  // -------------------------------------------------------------------
  // Infoskærme
  // -------------------------------------------------------------------
  await db.insert(schema.infoScreens).values([
    { id: id("screen"), name: "Reception", location: "Indgang", facilityIds: [], layout: "standard" },
    { id: id("screen"), name: "Hal 1", location: "Ved Hal 1", facilityIds: [hal1.id, hal1a.id, hal1b.id], layout: "enkelt_facilitet" },
    { id: id("screen"), name: "Hal 2", location: "Ved Hal 2", facilityIds: [hal2.id], layout: "enkelt_facilitet" },
  ]);

  // -------------------------------------------------------------------
  // Standardbruger (admin) til login-demo
  // -------------------------------------------------------------------
  const bcrypt = await import("bcryptjs");
  await db.insert(schema.users).values({
    id: id("user"),
    name: "Martin",
    email: "martin@grenaaic.dk",
    passwordHash: bcrypt.hashSync("demo1234", 10),
    role: "admin",
  });

  console.log("\nSeed færdig!");
  console.log(`Hal 1 id: ${hal1.id}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => sqlite.close());
