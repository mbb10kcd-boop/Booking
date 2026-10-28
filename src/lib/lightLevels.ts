/**
 * Lysniveauer i hallerne (styres via CTS, se /api/cts/status). Hver booking har
 * et niveau; ingen værdi (null) betyder standardniveauet 400 lux.
 */
export const LIGHT_LEVELS = [400, 700, 1000] as const;
export type LightLevel = (typeof LIGHT_LEVELS)[number];
export const DEFAULT_LIGHT_LEVEL: LightLevel = 400;

/** Gør en vilkårlig værdi til et gyldigt niveau (400/700/1000), ellers standard. */
export function normalizeLightLevel(v: unknown): LightLevel {
  const n = typeof v === "string" ? Number(v) : (v as number);
  return (LIGHT_LEVELS as readonly number[]).includes(n) ? (n as LightLevel) : DEFAULT_LIGHT_LEVEL;
}

type FacilityLike = { id: string; name: string; parentId: string | null };

/** Har faciliteten (eller dens hal) lysstyring? Gælder Opvisningshallen og Træningshallen (inkl. underfaciliteter). */
export function facilityHasLightControl(facilityId: string | undefined, facilities: FacilityLike[]): boolean {
  if (!facilityId) return false;
  let cur = facilities.find((f) => f.id === facilityId);
  for (let i = 0; i < 10 && cur?.parentId; i++) {
    const parent = facilities.find((f) => f.id === cur!.parentId);
    if (!parent) break;
    cur = parent;
  }
  return !!cur && /(opvisnings|trænings)hallen/i.test(cur.name);
}
