import { db, schema } from "@/db";
import { eq, and, ne, lt, gt } from "drizzle-orm";
import { newId } from "@/lib/ids";

type Facility = typeof schema.facilities.$inferSelect;

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
 * Opretter (om nødvendigt) en adgangskode til en booking og opdaterer
 * bookingen med den. Bruges alle steder en kode kan opstå: den offentlige
 * privatpersonportal, betalingsbekræftelse (badminton) og det generiske
 * access-codes-endpoint. Returnerer null hvis bookingen slet ikke er
 * berettiget til en kode (forening, eller lokale uden kodedør) - eller i
 * det ekstremt usandsynlige tilfælde at kodepuljen for døren er helt
 * opbrugt i det ønskede tidsrum.
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
