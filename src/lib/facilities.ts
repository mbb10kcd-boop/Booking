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

/**
 * To faciliteter "blokerer" hinanden hvis den ene er forælder/bedsteforælder
 * til den anden (eller de er samme facilitet). Søskende-underressourcer
 * (Hal 1A og Hal 1B) blokerer IKKE hinanden.
 */
export function facilitiesConflict(
  idA: string,
  idB: string,
  facilities: Facility[]
): boolean {
  if (idA === idB) return true;
  const parentMap = buildParentMap(facilities);
  const ancestorsOfA = new Set(getAncestorChain(idA, parentMap));
  const ancestorsOfB = new Set(getAncestorChain(idB, parentMap));
  // Konflikt hvis A er forfader til B eller omvendt
  if (ancestorsOfB.has(idA)) return true;
  if (ancestorsOfA.has(idB)) return true;
  return false;
}

export async function getFacilityPath(id: string, facilities: Facility[]): Promise<string> {
  const parentMap = buildParentMap(facilities);
  const chain = getAncestorChain(id, parentMap).reverse();
  return chain
    .map((fid) => facilities.find((f) => f.id === fid)?.name ?? "?")
    .join(" → ");
}
