import { db, schema } from "@/db";
import { eq } from "drizzle-orm";

export type Facility = typeof schema.facilities.$inferSelect;

export async function getAllFacilities(): Promise<Facility[]> {
  return db.select().from(schema.facilities).orderBy(schema.facilities.sortOrder);
}

/** Bygger facilitet-id -> forældre-id map, til hurtige opslag */
export function buildParentMap(facilities: Facility[]): Map<string, string | null> {
  const map = new Map<string, string | null>();
  for (const f of facilities) map.set(f.id, f.parentId);
  return map;
}

/** Alle forfædre (inkl. sig selv) for en facilitet */
export function getAncestorChain(id: string, parentMap: Map<string, string | null>): string[] {
  const chain = [id];
  let current = parentMap.get(id) ?? null;
  const seen = new Set([id]);
  while (current && !seen.has(current)) {
    chain.push(current);
    seen.add(current);
    current = parentMap.get(current) ?? null;
  }
  return chain;
}

/** Alle efterkommere (inkl. sig selv) for en facilitet */
export function getDescendantIds(id: string, facilities: Facility[]): string[] {
  const result = [id];
  const children = facilities.filter((f) => f.parentId === id);
  for (const child of children) {
    result.push(...getDescendantIds(child.id, facilities));
  }
  return result;
}

export type FacilityRelation = "same" | "block" | "warn" | "none";

/**
 * Følger forælder-kæden fra `descendantId` op mod roden og undersøger om
 * `ancestorId` findes i den. Returnerer den "løseste" konflikt-tilstand
 * fundet undervejs (dvs. "warn" hvis blot ét led på vejen er markeret som
 * "warn" - fx en klatrevæg under opvisningshallen), eller `null` hvis
 * `ancestorId` slet ikke er en forfader til `descendantId`.
 */
function pathRelation(
  descendantId: string,
  ancestorId: string,
  parentMap: Map<string, string | null>,
  facilityMap: Map<string, Facility>
): "block" | "warn" | null {
  let current: string | null = descendantId;
  let mode: "block" | "warn" = "block";
  const seen = new Set<string>();
  while (current) {
    if (seen.has(current)) return null; // beskyt mod cirkulære referencer
    seen.add(current);
    if (facilityMap.get(current)?.conflictMode === "warn") mode = "warn";
    const parent: string | null = parentMap.get(current) ?? null;
    if (parent === ancestorId) return mode;
    current = parent;
  }
  return null;
}

/**
 * Relationen mellem to faciliteter mht. booking-konflikt: "same" (samme
 * facilitet), "block" (den ene er forælder/bedsteforælder til den anden, og
 * mindst ét led i kæden er en hård kobling - fx badmintonbaner i
 * træningshallen), "warn" (samme slægtskab, men et løst koblet led
 * undervejs - fx en klatrevæg i opvisningshallen: kan bookes samtidig, men
 * bør give en bemærkning), eller "none" (ingen relation - fx to søskende-
 * underressourcer som Hal 1A og Hal 1B, der aldrig blokerer hinanden).
 */
export function facilityRelation(
  idA: string,
  idB: string,
  facilities: Facility[]
): FacilityRelation {
  if (idA === idB) return "same";
  const parentMap = buildParentMap(facilities);
  const facilityMap = new Map(facilities.map((f) => [f.id, f]));
  const bUnderA = pathRelation(idB, idA, parentMap, facilityMap);
  if (bUnderA) return bUnderA;
  const aUnderB = pathRelation(idA, idB, parentMap, facilityMap);
  if (aUnderB) return aUnderB;
  return "none";
}

/**
 * To faciliteter "blokerer" hinanden hvis den ene er forælder/bedsteforælder
 * til den anden (eller de er samme facilitet), og koblingen er "block".
 * Søskende-underressourcer (Hal 1A og Hal 1B) blokerer IKKE hinanden.
 */
export function facilitiesConflict(
  idA: string,
  idB: string,
  facilities: Facility[]
): boolean {
  const relation = facilityRelation(idA, idB, facilities);
  return relation === "same" || relation === "block";
}

/**
 * To faciliteter er løst koblet ("warn") hvis de er i familie, men
 * relationen er markeret som en bemærkning frem for en hård blokering (fx
 * klatrevæg/opvisningshal). Bruges til at vise en ikke-blokerende note ved
 * booking, uden at forhindre den.
 */
export function facilitiesWarn(idA: string, idB: string, facilities: Facility[]): boolean {
  return facilityRelation(idA, idB, facilities) === "warn";
}

export async function getFacilityPath(id: string, facilities: Facility[]): Promise<string> {
  const parentMap = buildParentMap(facilities);
  const chain = getAncestorChain(id, parentMap).reverse();
  return chain
    .map((fid) => facilities.find((f) => f.id === fid)?.name ?? "?")
    .join(" → ");
}
