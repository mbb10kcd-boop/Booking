/* eslint-disable @typescript-eslint/no-explicit-any */
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import path from "path";
import fs from "fs";
import { randomUUID } from "crypto";
import * as schema from "./schema";
import { parseBookingMail } from "../lib/ai/mailParser";

// Samme opløsning af databaseforbindelse som src/db/index.ts: brug en ekstern
// libsql/Turso-database når TURSO_DATABASE_URL er sat (persistent på tværs af
// deploys), ellers en lokal fil (kun til udvikling/test - se advarslen i
// src/db/index.ts om at Render's gratis plan ikke har en persistent disk).
const remoteUrl = process.env.TURSO_DATABASE_URL;
const sqlite = remoteUrl
  ? createClient({ url: remoteUrl, authToken: process.env.TURSO_AUTH_TOKEN })
  : (() => {
      const dbPath = process.env.DATABASE_PATH || path.join(process.cwd(), "data", "grenaa.db");
      const dir = path.dirname(dbPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      return createClient({ url: `file:${dbPath}` });
    })();
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
  // SIKKERHEDSSPÆRRE: dette script sletter ALT eksisterende data før det
  // sår nyt (se DELETE-sætningerne nedenfor). Det er fint på en tom
  // udviklingsdatabase, men må aldrig køre ubetinget mod en database der
  // allerede indeholder rigtige bookinger, foreninger osv. - hvilket den vil
  // gøre, fordi Render's build-kommando kører "db:seed" ved HVER deploy.
  // Springer derfor automatisk seedingen over, hvis der allerede er data
  // (fx en rigtig facilitet oprettet af en administrator). Sæt
  // FORCE_RESEED=1 hvis man bevidst vil nulstille til demo-data igen.
  // Sikrer at badmintonbanerne er skjult i foreningsportalen, uanset om vi
  // reseeder eller ej herunder (kører derfor FØR "spring over"-tjekket) - se
  // hiddenFromOrgPortal i schema.ts. Idempotent: kan trygt køre ved hver
  // deploy uden at påvirke andre felter.
  await sqlite.execute(
    "UPDATE facilities SET hidden_from_org_portal = 1 WHERE name LIKE 'Badmintonbane%' AND (hidden_from_org_portal IS NULL OR hidden_from_org_portal = 0)"
  );
  // Samme idempotente fixup for infoskærmene: badmintonbanerne må aldrig
  // fremgå af nogen infoskærm (Martin har bedt om at de slet ikke vises der)
  // - se hiddenFromInfoScreen i schema.ts.
  await sqlite.execute(
    "UPDATE facilities SET hidden_from_info_screen = 1 WHERE name LIKE 'Badmintonbane%' AND (hidden_from_info_screen IS NULL OR hidden_from_info_screen = 0)"
  );
  // Idempotent fixup for hvilke lokaler der rent faktisk har en kodedør fra
  // WeAccess (Martin: "der er kun kodedør på træningshallen og multisalen").
  // Badmintonbanerne har intet eget felt - de arver Træningshallens dør via
  // resolveDoorFacilityId() i src/lib/accessCodes.ts, da de deler samme
  // fysiske indgang. Se we_access_door_id i schema.ts.
  await sqlite.execute(
    "UPDATE facilities SET we_access_door_id = 'traeningshallen' WHERE name = 'Træningshallen' AND (we_access_door_id IS NULL OR we_access_door_id = '')"
  );
  await sqlite.execute(
    "UPDATE facilities SET we_access_door_id = 'multisalen' WHERE name = 'Multisalen' AND (we_access_door_id IS NULL OR we_access_door_id = '')"
  );

  // Faste dørkode-puljer (Martins forslag, da hverken WeAccess eller andre
  // undersøgte låsefabrikater tilbyder en brugbar API til at sende nye koder
  // automatisk - se doorCodePool i schema.ts): 20 faste koder pr. kodedør,
  // som personalet selv taster ind i den fysiske lås én gang. Koderne er
  // bevidst skrevet som faste tal herunder (ALDRIG genereret tilfældigt) -
  // ellers ville de ikke længere stemme med det, der rent fysisk står i
  // låsen. Indsættes kun hvis puljen for den pågældende dør er helt tom, så
  // den aldrig overskrives af en senere reseed. Se /doerkoder for oversigten
  // personalet skal bruge til selve indtastningen i låsene.
  const DOOR_CODE_POOLS: Record<string, string[]> = {
    traeningshallen: [
      "4960", "1602", "4120", "2274", "1745", "3580", "7211", "6715", "4081", "6417",
      "6358", "2153", "6861", "5698", "2137", "7645", "4253", "1456", "9987", "9230",
    ],
    multisalen: [
      "4245", "7955", "5680", "8613", "9787", "9345", "3055", "1573", "8108", "1922",
      "5356", "7950", "9090", "4342", "3993", "3791", "2019", "3262", "9690", "6353",
    ],
  };
  for (const [doorId, codes] of Object.entries(DOOR_CODE_POOLS)) {
    const existingPool = await sqlite.execute({
      sql: "SELECT COUNT(*) as c FROM door_code_pool WHERE door_id = ?",
      args: [doorId],
    });
    const poolCount = Number((existingPool.rows[0] as { c?: number | string })?.c ?? 0);
    if (poolCount === 0) {
      for (const code of codes) {
        await sqlite.execute({
          sql: "INSERT INTO door_code_pool (id, door_id, code, created_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)",
          args: [id("doorcode"), doorId, code],
        });
      }
    }
  }

  if (process.env.FORCE_RESEED !== "1") {
    const existing = await sqlite.execute("SELECT COUNT(*) as c FROM facilities");
    const count = Number((existing.rows[0] as { c?: number | string })?.c ?? 0);
    if (count > 0) {
      console.log(
        `Databasen indeholder allerede ${count} facilitet(er) - springer seed over for ikke at overskrive rigtige data. Sæt FORCE_RESEED=1 for at gennemtvinge nulstilling til demo-data.`
      );
      return;
    }
  }

  console.log("Nulstiller eksisterende data...");
  await sqlite.executeMultiple(`
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
  // Faciliteter - centerets rigtige facilitetsopbygning (opgivet af Martin):
  //
  //   Opvisningshallen
  //   - Klatrevæg          (LØST koblet - "warn": kan bookes samtidig med
  //                          Opvisningshallen, men giver en bemærkning, da
  //                          nogle gæster foretrækker at have hallen for sig
  //                          selv mens der klatres)
  //   Træningshallen
  //   - Badmintonbane 1-6  (HÅRDT koblet - "block", standardopførsel: er
  //                          hele træningshallen booket, kan banerne ikke
  //                          bookes, og omvendt - men banerne blokerer ikke
  //                          hinanden indbyrdes)
  //   Multisalen
  //   Mødelokale 1-4
  //   Klubsekretariatet
  //
  // Se conflictMode-kolonnen i src/db/schema.ts og facilityRelation() i
  // src/lib/facilities.ts for selve konflikt-/advarselslogikken.
  // -------------------------------------------------------------------
  const opvisningshallen = { id: id("fac"), name: "Opvisningshallen", capacity: 400, color: "#2563eb", sortOrder: 1 };
  const klatrevaeg = {
    id: id("fac"),
    name: "Klatrevæg",
    parentId: opvisningshallen.id,
    conflictMode: "warn" as const,
    capacity: 10,
    color: "#a855f7",
    sortOrder: 2,
  };
  const traeningshallen = {
    id: id("fac"),
    name: "Træningshallen",
    capacity: 150,
    color: "#059669",
    sortOrder: 3,
    // WeAccess-dørens id - se resolveDoorFacilityId() i src/lib/accessCodes.ts.
    weAccessDoorId: "traeningshallen",
  };
  const badmintonbaner = [1, 2, 3, 4, 5, 6].map((n) => ({
    id: id("fac"),
    name: `Badmintonbane ${n}`,
    parentId: traeningshallen.id,
    capacity: 4,
    pricePerHour: 120,
    requiresPayment: true,
    color: "#f97316",
    sortOrder: 3 + n,
    // Badmintonbanerne skal IKKE kunne vælges i foreningsportalen (se
    // hiddenFromOrgPortal i schema.ts) - kun i den interne admin-kalender.
    hiddenFromOrgPortal: true,
    // Skal heller ALDRIG fremgå af infoskærmene (Martin: banerne er interne
    // og skal ikke optage plads/synlighed på de fastmonterede skærme).
    hiddenFromInfoScreen: true,
  }));
  const multisalen = {
    id: id("fac"),
    name: "Multisalen",
    capacity: 60,
    color: "#7c3aed",
    sortOrder: 10,
    weAccessDoorId: "multisalen",
  };
  const moedelokaler = [1, 2, 3, 4].map((n) => ({
    id: id("fac"),
    name: `Mødelokale ${n}`,
    capacity: 12,
    color: "#64748b",
    sortOrder: 10 + n,
  }));
  const klubsekretariatet = { id: id("fac"), name: "Klubsekretariatet", capacity: 6, color: "#475569", sortOrder: 15 };

  const allFacilities = [
    opvisningshallen,
    klatrevaeg,
    traeningshallen,
    ...badmintonbaner,
    multisalen,
    ...moedelokaler,
    klubsekretariatet,
  ];
  for (const f of allFacilities) {
    await db.insert(schema.facilities).values({
      id: f.id,
      name: f.name,
      parentId: (f as any).parentId ?? null,
      conflictMode: (f as any).conflictMode ?? "block",
      capacity: f.capacity,
      pricePerHour: (f as any).pricePerHour ?? 0,
      requiresPayment: (f as any).requiresPayment ?? false,
      color: f.color,
      sortOrder: f.sortOrder,
      bookingTypes: [],
      hiddenFromOrgPortal: (f as any).hiddenFromOrgPortal ?? false,
      hiddenFromInfoScreen: (f as any).hiddenFromInfoScreen ?? false,
      weAccessDoorId: (f as any).weAccessDoorId ?? null,
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
    facilityId: badmintonbaner[0].id,
    title: "Motionsbadminton",
    startsAt: `${todayIso}T08:00:00`,
    endsAt: `${todayIso}T09:30:00`,
  });
  await addBooking({
    facilityId: opvisningshallen.id,
    title: "Skolearrangement",
    startsAt: `${todayIso}T10:00:00`,
    endsAt: `${todayIso}T12:00:00`,
  });
  // Demo af den nye LØSE kobling: klatrevæggen bookes samtidig med at
  // Opvisningshallen bruges til skolearrangementet ovenfor - det er
  // tilladt (blokerer ikke), men vil give en bemærkning hvis man
  // efterfølgende forsøger at booke enten hallen eller klatrevæggen i
  // dette tidsrum (se facilitiesWarn() i src/lib/facilities.ts).
  await addBooking({
    facilityId: klatrevaeg.id,
    title: "Klatreklub - fri klatring",
    startsAt: `${todayIso}T10:00:00`,
    endsAt: `${todayIso}T12:00:00`,
  });
  await addBooking({
    facilityId: opvisningshallen.id,
    title: "GIF Håndbold",
    organizationId: gifHaandbold.id,
    startsAt: `${todayIso}T14:00:00`,
    endsAt: `${todayIso}T16:00:00`,
  });
  await addBooking({
    facilityId: traeningshallen.id,
    title: "GIF Gymnastik",
    organizationId: gifGymnastik.id,
    startsAt: `${todayIso}T18:00:00`,
    endsAt: `${todayIso}T20:00:00`,
  });

  // -------------------------------------------------------------------
  // Eksisterende sæsonbooking: GIF Håndbold, tirsdage 17-19 i Træningshallen
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
      facilityId: traeningshallen.id,
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

Mandag 16.00-18.00 i Opvisningshallen
Tirsdag 17.00-19.00 i Træningshallen
Onsdag 18.00-20.00 i Multisalen

Periode: ${String(seasonStart.getDate()).padStart(2, "0")}/${String(seasonStart.getMonth() + 1).padStart(2, "0")}-${String(seasonEnd.getDate()).padStart(2, "0")}/${String(seasonEnd.getMonth() + 1).padStart(2, "0")}

Mvh
Lise Andersen
lise@gifgymnastik.dk
23456789`;

  // Bruger en facilitet uden eksisterende bookinger i dag (Mødelokale 2), så
  // denne demo-mail pålideligt viser "ledig" uanset hvilken ugedag scriptet
  // køres på (undgår at kollidere med dagens eksempelprogram ovenfor).
  const singleMailFree = `Hej

Kan vi leje Mødelokale 2 lørdag fra kl. 14-16?

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
  //
  // Martin: skærmene hænger fast og kan ikke scrolles, så de skal altid
  // kunne vise deres indhold uden at løbe over. "Reception" er
  // oversigtsskærmen der viser hele centeret på én gang - her skal
  // Opvisningshallen, Træningshallen og Multisalen ALTID stå (også hvis de
  // er helt ledige i dag), mens de øvrige lokaler (mødelokaler,
  // klubsekretariatet, klatrevæggen) kun fylder på skærmen de dage, hvor de
  // rent faktisk er booket - se `pinnedFacilityIds` i schema.ts og
  // udvælgelseslogikken i /api/screens/[id]. Badmintonbanerne er skjult helt
  // (hiddenFromInfoScreen ovenfor) og optræder derfor slet ikke, uanset
  // hvilken skærm man ser.
  // -------------------------------------------------------------------
  await db.insert(schema.infoScreens).values([
    {
      id: id("screen"),
      name: "Reception",
      location: "Indgang",
      facilityIds: [], // tomt = alle (ikke-skjulte) faciliteter er i spil
      pinnedFacilityIds: [opvisningshallen.id, traeningshallen.id, multisalen.id],
      layout: "standard",
    },
    {
      id: id("screen"),
      name: "Opvisningshallen",
      location: "Ved Opvisningshallen",
      facilityIds: [opvisningshallen.id, klatrevaeg.id],
      pinnedFacilityIds: [opvisningshallen.id, klatrevaeg.id],
      layout: "enkelt_facilitet",
    },
    {
      id: id("screen"),
      name: "Træningshallen",
      location: "Ved Træningshallen",
      // Badmintonbanerne er bevidst IKKE med her længere - de skal aldrig
      // vises på nogen infoskærm (se hiddenFromInfoScreen).
      facilityIds: [traeningshallen.id],
      pinnedFacilityIds: [traeningshallen.id],
      layout: "enkelt_facilitet",
    },
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
  console.log(`Opvisningshallen id: ${opvisningshallen.id}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => sqlite.close());
