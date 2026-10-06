import { db, schema } from "@/db";
import { eq, and, ne, lt, gt, inArray, isNotNull } from "drizzle-orm";
import { newId } from "@/lib/ids";
import { logAudit } from "@/lib/audit";
import {
  isWeAccessEnabled,
  isRealWeAccessDoorId,
  createVisit,
  updateVisit,
  deleteVisit,
} from "@/lib/weaccess";

type Facility = typeof schema.facilities.$inferSelect;

const INACTIVE_STATUSES = ["aflyst", "afvist"] as const;

/**
 * Finder id'et for den fysiske kodedør en facilitet reelt hører under, ved
 * at gå op i facilitets-hierarkiet (samme mønster som konflikttjekket i
 * src/lib/conflicts.ts). En badmintonbane har intet eget weAccessDoorId,
 * men arver Træningshallens, da banerne deler samme fysiske indgang.
 * Returnerer null hvis hverken faciliteten selv eller nogen af dens
 * forældre har en kodedør (fx Opvisningshallen, mødelokalerne).
 */
export function resolveDoorFacilityId(facility: Facility, allFacilities: Facility[]): string | null {
  let current: Facility | undefined = facility;
  const seen = new Set<string>();
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    if (current.weAccessDoorId) return current.weAccessDoorId;
    current = current.parentId ? allFacilities.find((f) => f.id === current!.parentId) : undefined;
  }
  return null;
}

export function shouldGenerateAccessCode(opts: {
  organizationId: string | null | undefined;
  facility: Facility;
  allFacilities: Facility[];
}): boolean {
  // Foreninger får aldrig en kode - dørene står allerede åbne i deres tid
  // (Martin). Kun privatpersoner (ingen organizationId) er relevante her.
  if (opts.organizationId) return false;
  return resolveDoorFacilityId(opts.facility, opts.allFacilities) !== null;
}

/**
 * Finder en ledig kode fra dørens faste kodepulje (se doorCodePool i
 * schema.ts og /doerkoder). "Ledig" betyder her: ikke allerede tildelt en
 * anden AKTIV booking (dvs. ikke aflyst/afvist) hvis gyldighedsperiode
 * overlapper det ønskede tidsrum på samme dør. Koderne selv ændrer sig
 * aldrig - det er kun tildelingen af hvem der har hvilken kode hvornår,
 * der styres her. Returnerer null hvis puljen er tom, eller (meget
 * usandsynligt givet puljestørrelsen) alle koder allerede er i brug i det
 * ønskede tidsrum.
 *
 * Bruges kun som reserveløsning, når WeAccess-integrationen ikke er slået
 * til (WEACCESS_API_KEY ikke sat) eller døren ikke har et rigtigt WeAccess-id.
 */
async function assignPoolCode(doorId: string, startsAt: string, endsAt: string): Promise<string | null> {
  const pool = await db.select().from(schema.doorCodePool).where(eq(schema.doorCodePool.doorId, doorId));
  if (pool.length === 0) return null;

  const overlapping = await db
    .select({ code: schema.accessCodes.code })
    .from(schema.accessCodes)
    .innerJoin(schema.bookings, eq(schema.accessCodes.bookingId, schema.bookings.id))
    .where(
      and(
        eq(schema.accessCodes.doorId, doorId),
        lt(schema.accessCodes.validFrom, endsAt),
        gt(schema.accessCodes.validTo, startsAt),
        ne(schema.bookings.status, "aflyst"),
        ne(schema.bookings.status, "afvist")
      )
    );

  const busy = new Set(overlapping.map((row) => row.code));
  const free = pool.find((entry) => !busy.has(entry.code));
  return free ? free.code : null;
}

/**
 * Opretter en tidsbegrænset kode på selve låsen via WeAccess. WeAccess
 * genererer selv koden (gyldig og ledig på døren). Går noget galt (fx
 * gatewayen i hallen er offline), oprettes INGEN kode - vi falder bevidst
 * ikke tilbage til poolen, fordi en pool-kode ikke er programmeret i låsen
 * og derfor ville give gæsten en kode der ikke virker. Fejlen logges i
 * bookinghistorikken, så personalet kan se den og oprette koden senere.
 */
async function createWeAccessCode(
  opts: { bookingId: string; facility: Facility; startsAt: string; endsAt: string },
  doorId: string
): Promise<string | null> {
  const [booking] = await db.select().from(schema.bookings).where(eq(schema.bookings.id, opts.bookingId));
  const who = booking?.contactName || booking?.title || "Gæst";
  const label = opts.facility.bookableGroupLabel || opts.facility.name;
  const name = `${label} - ${who}`;

  let lastError: unknown = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const visit = await createVisit({
        name,
        doorId,
        startsAtLocal: opts.startsAt,
        endsAtLocal: opts.endsAt,
        externalVisitId: opts.bookingId,
      });
      await db.insert(schema.accessCodes).values({
        id: newId("code"),
        bookingId: opts.bookingId,
        facilityId: opts.facility.id,
        doorId,
        weAccessVisitId: visit.visitId,
        code: visit.code,
        validFrom: opts.startsAt,
        validTo: opts.endsAt,
        active: true,
        usageLog: [{ at: new Date().toISOString(), event: `oprettet i WeAccess (visit ${visit.visitId})` }],
      });
      await db.update(schema.bookings).set({ accessCode: visit.code }).where(eq(schema.bookings.id, opts.bookingId));
      return visit.code;
    } catch (err) {
      lastError = err;
    }
  }
  const msg = lastError instanceof Error ? lastError.message : String(lastError);
  console.error(`WeAccess: kunne ikke oprette kode til booking ${opts.bookingId}: ${msg}`);
  await logAudit("booking", opts.bookingId, "adgangskode_fejlet", `Kunne ikke oprette dørkode i WeAccess: ${msg}`);
  return null;
}

/**
 * Opretter (om nødvendigt) en adgangskode til en booking og opdaterer
 * bookingen med den. Bruges alle steder en kode kan opstå: den offentlige
 * privatpersonportal, betalingsbekræftelse (badminton) og det generiske
 * access-codes-endpoint. Returnerer null hvis bookingen slet ikke er
 * berettiget til en kode (forening, eller lokale uden kodedør) - eller hvis
 * koden ikke kunne oprettes (WeAccess-fejl, eller tom kodepulje).
 *
 * Er WeAccess-integrationen slået til (WEACCESS_API_KEY sat) og døren har et
 * rigtigt WeAccess-id, oprettes en rigtig kode på låsen. Ellers bruges den
 * gamle faste kodepulje som reserveløsning.
 */
export async function maybeCreateAccessCode(opts: {
  bookingId: string;
  organizationId: string | null | undefined;
  facility: Facility;
  allFacilities: Facility[];
  startsAt: string;
  endsAt: string;
}): Promise<string | null> {
  if (!shouldGenerateAccessCode(opts)) return null;

  const doorId = resolveDoorFacilityId(opts.facility, opts.allFacilities);
  if (!doorId) return null; // bør ikke kunne ske pga. shouldGenerateAccessCode-tjekket ovenfor

  if (isWeAccessEnabled() && isRealWeAccessDoorId(doorId)) {
    return createWeAccessCode(opts, doorId);
  }

  const code = await assignPoolCode(doorId, opts.startsAt, opts.endsAt);
  if (!code) return null;

  await db.insert(schema.accessCodes).values({
    id: newId("code"),
    bookingId: opts.bookingId,
    facilityId: opts.facility.id,
    doorId,
    code,
    validFrom: opts.startsAt,
    validTo: opts.endsAt,
    active: true,
    usageLog: [{ at: new Date().toISOString(), event: "tildelt fra kodepulje" }],
  });
  await db.update(schema.bookings).set({ accessCode: code }).where(eq(schema.bookings.id, opts.bookingId));
  return code;
}

/**
 * Er der andre AKTIVE bookinger i samme flerbane-gruppe (multiBookingGroupId)?
 * En flerbane-bestilling deler ÉN kode (én WeAccess-visit, hængt på den første
 * booking), som derfor ikke må spærres/flyttes fordi én af banerne aflyses.
 */
async function hasActiveGroupSiblings(bookingId: string): Promise<boolean> {
  const [booking] = await db.select().from(schema.bookings).where(eq(schema.bookings.id, bookingId));
  if (!booking?.multiBookingGroupId) return false;
  const siblings = await db
    .select({ id: schema.bookings.id })
    .from(schema.bookings)
    .where(
      and(
        eq(schema.bookings.multiBookingGroupId, booking.multiBookingGroupId),
        ne(schema.bookings.id, bookingId),
        ...INACTIVE_STATUSES.map((s) => ne(schema.bookings.status, s))
      )
    );
  return siblings.length > 0;
}

/**
 * Spærrer koden på låsen (WeAccess) når en booking aflyses/afvises. Idempotent:
 * kan trygt kaldes flere gange. Kun koder der hænger på en WeAccess-visit
 * berøres - pool-koder er ikke programmeret via systemet. Fejl her kaster
 * ALDRIG (aflysningen af selve bookingen må ikke fejle pga. låsesystemet),
 * men skrives i bookinghistorikken.
 */
export async function revokeAccessCodesForBooking(bookingId: string): Promise<void> {
  try {
    const rows = await db
      .select()
      .from(schema.accessCodes)
      .where(and(eq(schema.accessCodes.bookingId, bookingId), isNotNull(schema.accessCodes.weAccessVisitId)));
    const live = rows.filter((r) => r.active !== false);
    if (live.length === 0) return;
    if (await hasActiveGroupSiblings(bookingId)) return;

    for (const row of live) {
      try {
        await deleteVisit(row.weAccessVisitId!);
        await db
          .update(schema.accessCodes)
          .set({
            active: false,
            usageLog: [...(row.usageLog ?? []), { at: new Date().toISOString(), event: "spærret i WeAccess (booking aflyst)" }],
          })
          .where(eq(schema.accessCodes.id, row.id));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`WeAccess: kunne ikke spærre kode for booking ${bookingId}: ${msg}`);
        await logAudit("booking", bookingId, "adgangskode_fejlet", `Kunne ikke spærre dørkode i WeAccess: ${msg}`);
      }
    }
  } catch (err) {
    console.error("revokeAccessCodesForBooking fejlede:", err);
  }
}

/**
 * Kaldes når en bookings tid og/eller facilitet er ændret. Har bookingen en
 * WeAccess-kode på samme dør, flyttes den (koden forbliver den samme - jf.
 * Alis anbefaling: slet ikke og opret ny). Ellers nulstilles koden, og der
 * oprettes en ny efter de almindelige regler (fx hvis bookingen flyttes til et
 * lokale med en anden dør, eller til et lokale uden kodedør).
 */
export async function resetAccessCodeForBooking(opts: {
  bookingId: string;
  organizationId: string | null | undefined;
  facility: Facility | undefined;
  allFacilities: Facility[];
  startsAt: string;
  endsAt: string;
  status: string;
}): Promise<void> {
  if (opts.status === "aflyst" || opts.status === "afvist") {
    await revokeAccessCodesForBooking(opts.bookingId);
    return;
  }

  const rows = await db.select().from(schema.accessCodes).where(eq(schema.accessCodes.bookingId, opts.bookingId));
  const visitRows = rows.filter((r) => r.weAccessVisitId && r.active !== false);

  const eligible = opts.facility
    ? shouldGenerateAccessCode({
        organizationId: opts.organizationId,
        facility: opts.facility,
        allFacilities: opts.allFacilities,
      })
    : false;
  const newDoorId = opts.facility ? resolveDoorFacilityId(opts.facility, opts.allFacilities) : null;

  if (visitRows.length > 0 && (await hasActiveGroupSiblings(opts.bookingId))) {
    // Den fælles kode tilhører hele flerbane-bestillingen og kan ikke flyttes
    // for én bane alene - lad den stå og gør personalet opmærksom på det.
    await logAudit(
      "booking",
      opts.bookingId,
      "adgangskode_uaendret",
      "Bookingen er flyttet, men dørkoden er fælles for flere baner og er IKKE flyttet med - tjek koden manuelt."
    );
    return;
  }

  // Samme dør, stadig berettiget: flyt den eksisterende kode i WeAccess.
  if (visitRows.length === 1 && eligible && newDoorId && visitRows[0].doorId === newDoorId) {
    const row = visitRows[0];
    try {
      await updateVisit(row.weAccessVisitId!, opts.startsAt, opts.endsAt);
      await db
        .update(schema.accessCodes)
        .set({
          validFrom: opts.startsAt,
          validTo: opts.endsAt,
          facilityId: opts.facility!.id,
          usageLog: [...(row.usageLog ?? []), { at: new Date().toISOString(), event: "flyttet i WeAccess" }],
        })
        .where(eq(schema.accessCodes.id, row.id));
      return;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`WeAccess: kunne ikke flytte kode for booking ${opts.bookingId}: ${msg}`);
      await logAudit("booking", opts.bookingId, "adgangskode_fejlet", `Kunne ikke flytte dørkode i WeAccess (opretter ny): ${msg}`);
      // falder igennem: spær den gamle og opret en ny
    }
  }

  for (const row of visitRows) {
    try {
      await deleteVisit(row.weAccessVisitId!);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await logAudit("booking", opts.bookingId, "adgangskode_fejlet", `Kunne ikke spærre gammel dørkode i WeAccess: ${msg}`);
    }
  }
  await db.delete(schema.accessCodes).where(eq(schema.accessCodes.bookingId, opts.bookingId));
  await db.update(schema.bookings).set({ accessCode: null }).where(eq(schema.bookings.id, opts.bookingId));

  if (opts.facility) {
    await maybeCreateAccessCode({
      bookingId: opts.bookingId,
      organizationId: opts.organizationId,
      facility: opts.facility,
      allFacilities: opts.allFacilities,
      startsAt: opts.startsAt,
      endsAt: opts.endsAt,
    });
  }
}

/** Bruges af kaldere der kun har en liste af bookinger (fx hele sæsonen). */
export async function revokeAccessCodesForBookings(bookingIds: string[]): Promise<void> {
  if (bookingIds.length === 0) return;
  const withVisits = await db
    .select({ bookingId: schema.accessCodes.bookingId })
    .from(schema.accessCodes)
    .where(and(inArray(schema.accessCodes.bookingId, bookingIds), isNotNull(schema.accessCodes.weAccessVisitId)));
  for (const id of new Set(withVisits.map((r) => r.bookingId))) {
    await revokeAccessCodesForBooking(id);
  }
}
