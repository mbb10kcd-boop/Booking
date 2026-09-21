import { db, schema } from "@/db";
import { eq } from "drizzle-orm";
import { newId } from "@/lib/ids";

type Facility = typeof schema.facilities.$inferSelect;

/**
 * Finder id'et for den fysiske WeAccess-dør en booking af `facility` reelt
 * skal bruge, ved at gå op gennem facilitetshierarkiet (parentId) indtil en
 * facilitet med et sat weAccessDoorId findes. En badmintonbane (som er en
 * underressource af Træningshallen) bruger dermed automatisk Træningshallens
 * dør uden selv at skulle konfigureres - ligesom konflikt-tjekket allerede
 * bruger hierarkiet på samme måde (se src/lib/conflicts.ts). Returnerer null
 * hvis hverken faciliteten selv eller nogen af dens forældre har en kodedør
 * (fx Opvisningshallen, mødelokalerne, klubsekretariatet).
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

/**
 * Skal denne booking overhovedet have en adgangskode?
 *
 * Martin (centerchef): kun PRIVATPERSONER skal have tilsendt en kode -
 * foreninger skal ikke, da dørene allerede står åbne når de har tid booket.
 * Og der er kun kodedøre ved Træningshallen og Multisalen (badmintonbanerne
 * bruger Træningshallens dør, se resolveDoorFacilityId ovenfor) - de øvrige
 * lokaler har slet ingen kodedør, så der er intet at sende en kode til.
 */
export function shouldGenerateAccessCode(opts: {
  organizationId: string | null | undefined;
  facility: Facility;
  allFacilities: Facility[];
}): boolean {
  if (opts.organizationId) return false;
  return resolveDoorFacilityId(opts.facility, opts.allFacilities) !== null;
}

/**
 * Genererer (hvis relevant, jf. shouldGenerateAccessCode ovenfor) en
 * adgangskode til en booking og gemmer den både i access_codes-tabellen og på
 * selve bookingen. Returnerer koden, eller null hvis denne booking ikke skal
 * have en (forening, eller et lokale uden kodedør) - kald-stedet skal i så
 * fald bare undlade at nævne nogen dørkode i sin bekræftelse.
 *
 * OBS: der er p.t. ingen forbindelse til WeAccess' system her - koden
 * genereres og gemmes internt, præcis som hidtil (se weAccessDoorId i
 * src/db/schema.ts for status). Når/hvis en rigtig integration bliver mulig,
 * er dette stedet at tilføje det API-kald.
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

  const code = String(Math.floor(1000 + Math.random() * 9000));
  await db.insert(schema.accessCodes).values({
    id: newId("code"),
    bookingId: opts.bookingId,
    facilityId: opts.facility.id,
    code,
    validFrom: opts.startsAt,
    validTo: opts.endsAt,
    active: true,
    usageLog: [{ at: new Date().toISOString(), event: "genereret" }],
  });
  await db.update(schema.bookings).set({ accessCode: code }).where(eq(schema.bookings.id, opts.bookingId));
  return code;
}
