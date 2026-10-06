/**
 * Klient til WeAccess' Partner API (dørlåse/PIN-koder) - se
 * ARKITEKTUR.md. Bruges KUN fra serversiden: API-nøglen må aldrig ud i
 * browseren eller i git.
 *
 * Konfiguration (miljøvariabler på Render):
 *   WEACCESS_API_KEY     (HEMMELIG - uden den er integrationen slået fra, og
 *                         systemet falder tilbage til den faste kodepulje)
 *   WEACCESS_PARTNER_KEY (valgfri, standard "grenaa-ic")
 *   WEACCESS_PROFILE_ID  (valgfri, standard Grenaa IC's anlæg)
 *   WEACCESS_BASE_URL    (valgfri, standard https://api.weaccess.net)
 *
 * Endpoints (fra Alis besked + partnerguiden):
 *   POST   /we-access/partner/<profile>/visit            opret kode ("visit")
 *   PATCH  /we-access/partner/<profile>/visit/<visitId>  flyt (koden bevares)
 *   DELETE /we-access/partner/<profile>/visit/<visitId>  aflys (spærres straks)
 *   GET    /we-access/partner/<profile>/doors            alle døre
 *
 * OBS: Alis besked bruger stien uden "/api"-præfiks, mens partnerguiden og
 * Postman-collectionen bruger "/api/we-access/...". Klienten prøver derfor
 * begge (først "/api" som i Postman, derefter uden) ved 404 og husker den der
 * virker.
 */

/**
 * Env-variabler bliver nogle gange indsat med ekstra linjer/tekst (fx hele
 * header-blokken fra mailen). Vi bruger kun første "ord" (op til mellemrum/
 * linjeskift), så en rodet værdi ikke giver ugyldige HTTP-headers.
 */
function firstToken(v: string | undefined): string {
  return (v ?? "").trim().split(/\s+/)[0] ?? "";
}

const BASE_URL = (process.env.WEACCESS_BASE_URL || "https://api.weaccess.net").replace(/\/+$/, "");
const PARTNER_KEY = firstToken(process.env.WEACCESS_PARTNER_KEY) || "grenaa-ic";
const PROFILE_ID = firstToken(process.env.WEACCESS_PROFILE_ID) || "DA2A2C79A9EF262F";
const TIMEOUT_MS = 15_000;

export function isWeAccessEnabled(): boolean {
  return !!firstToken(process.env.WEACCESS_API_KEY);
}

/**
 * De rigtige WeAccess-dør-id'er er rene tal (fx "25577710"). Ældre
 * placeholder-værdier som "traeningshallen" hører til den faste kodepulje og
 * skal ikke sendes til WeAccess.
 */
export function isRealWeAccessDoorId(doorId: string | null | undefined): doorId is string {
  return !!doorId && /^\d+$/.test(doorId);
}

export class WeAccessError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "WeAccessError";
    this.status = status;
  }
}

// ---------------------------------------------------------------------------
// Tidszone: bookinger gemmes som naive lokale tider (Europe/Copenhagen, se
// src/lib/date.ts). WeAccess tolker tider uden tidszone som UTC, så de skal
// sendes med korrekt offset (+01:00 / +02:00) - også omkring sommertid.
// ---------------------------------------------------------------------------
function copenhagenOffsetMinutes(utcMs: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Copenhagen",
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(utcMs));
  const get = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((asUtc - Math.floor(utcMs / 1000) * 1000) / 60_000);
}

/** "2026-10-12T17:00:00" (lokal dansk tid) -> "2026-10-12T17:00:00+02:00" */
export function localToOffsetISO(naive: string): string {
  const m = naive.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) throw new Error(`Ugyldigt tidspunkt: ${naive}`);
  const [, y, mo, d, h, mi, s = "00"] = m;
  const wall = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));
  // To omgange, så skiftedage (sommer-/vintertid) rammer den rigtige offset.
  let offset = copenhagenOffsetMinutes(wall - 2 * 3_600_000);
  offset = copenhagenOffsetMinutes(wall - offset * 60_000);
  const sign = offset >= 0 ? "+" : "-";
  const abs = Math.abs(offset);
  const hh = String(Math.floor(abs / 60)).padStart(2, "0");
  const mm = String(abs % 60).padStart(2, "0");
  return `${y}-${mo}-${d}T${h}:${mi}:${s}${sign}${hh}:${mm}`;
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------
let workingPrefix: string | null = null; // "/api" eller ""

async function rawRequest(
  prefix: string,
  method: string,
  path: string,
  body?: unknown,
  idempotencyKey?: string
): Promise<{ status: number; text: string }> {
  const apiKey = firstToken(process.env.WEACCESS_API_KEY);
  if (!apiKey) throw new WeAccessError(0, "WEACCESS_API_KEY er ikke sat");
  const headers: Record<string, string> = {
    "x-partner-key": PARTNER_KEY,
    "x-api-key": apiKey,
    "x-profile-id": PROFILE_ID,
    Accept: "application/json",
  };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (idempotencyKey) headers["x-idempotency-key"] = idempotencyKey;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE_URL}${prefix}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    return { status: res.status, text: await res.text() };
  } catch (err) {
    // Fejlbeskeden må aldrig indeholde header-værdier (nøglen) – brug kun en generisk tekst.
    const aborted = err instanceof Error && err.name === "AbortError";
    const msg = aborted ? "timeout" : err instanceof Error ? err.name : "ukendt fejl";
    throw new WeAccessError(0, `Netværksfejl mod WeAccess: ${msg}`);
  } finally {
    clearTimeout(timer);
  }
}

async function request(method: string, path: string, body?: unknown, idempotencyKey?: string) {
  const prefixes = workingPrefix !== null ? [workingPrefix] : ["/api", ""];
  let last: { status: number; text: string } | null = null;
  for (let i = 0; i < prefixes.length; i++) {
    const res = await rawRequest(prefixes[i], method, path, body, idempotencyKey);
    last = res;
    // 404 før vi kender det rigtige præfiks tyder på forkert sti - prøv næste.
    if (res.status === 404 && workingPrefix === null && i < prefixes.length - 1) continue;
    if (res.status < 400) workingPrefix = prefixes[i];
    break;
  }
  if (!last) throw new WeAccessError(0, "Ingen svar fra WeAccess");
  let json: unknown = null;
  try {
    json = last.text ? JSON.parse(last.text) : null;
  } catch {
    json = null;
  }
  if (last.status >= 400) {
    throw new WeAccessError(last.status, `WeAccess svarede ${last.status}: ${last.text.slice(0, 300)}`);
  }
  return { status: last.status, json };
}

/** Finder første værdi for en af nøglerne et vilkårligt sted i svaret. */
function findDeep(value: unknown, keys: string[], depth = 0): string | null {
  if (value == null || depth > 5) return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const hit = findDeep(item, keys, depth + 1);
      if (hit) return hit;
    }
    return null;
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    for (const k of keys) {
      const v = obj[k];
      if ((typeof v === "string" || typeof v === "number") && String(v) !== "") return String(v);
    }
    for (const v of Object.values(obj)) {
      const hit = findDeep(v, keys, depth + 1);
      if (hit) return hit;
    }
  }
  return null;
}

const profilePath = `/we-access/partner/${PROFILE_ID}`;

export type WeAccessVisit = { visitId: string; code: string };

/**
 * Opretter en tidsbegrænset PIN-kode ("visit") på én dør. Koden udelades med
 * vilje, så WeAccess selv genererer en gyldig og ledig kode (de afviser fx
 * 1111/1234 og koder der allerede bruges på døren). `externalVisitId` er vores
 * booking-id - sendes samme id igen, opdateres den eksisterende visit.
 */
export async function createVisit(opts: {
  name: string;
  doorId: string;
  startsAtLocal: string;
  endsAtLocal: string;
  externalVisitId: string;
}): Promise<WeAccessVisit> {
  const validFrom = localToOffsetISO(opts.startsAtLocal);
  const validTo = localToOffsetISO(opts.endsAtLocal);
  const { json } = await request(
    "POST",
    `${profilePath}/visit`,
    {
      name: opts.name.slice(0, 80),
      validFrom,
      validTo,
      externalVisitId: opts.externalVisitId,
      deleteAfterPeriod: 1,
      unlocks: [{ id: opts.doorId, type: "Door" }],
    },
    `${opts.externalVisitId}|${opts.doorId}|${validFrom}|${validTo}`
  );
  const visitId = findDeep(json, ["visitId", "visit_id", "id"]);
  const code = findDeep(json, ["code", "pin", "pinCode"]);
  if (!visitId || !code) {
    // Visit'en kan være oprettet uden at vi kan bruge svaret - ryd op, så der
    // ikke bliver en forladt kode på døren.
    if (visitId) await deleteVisit(visitId).catch(() => undefined);
    throw new WeAccessError(502, `Uventet svar fra WeAccess (mangler visitId/kode): ${JSON.stringify(json).slice(0, 200)}`);
  }
  return { visitId, code };
}

/** Flytter en eksisterende visit (koden forbliver den samme). */
export async function updateVisit(visitId: string, startsAtLocal: string, endsAtLocal: string): Promise<void> {
  await request("PATCH", `${profilePath}/visit/${encodeURIComponent(visitId)}`, {
    validFrom: localToOffsetISO(startsAtLocal),
    validTo: localToOffsetISO(endsAtLocal),
  });
}

/** Spærrer koden med det samme. En visit der allerede er væk (404) regnes som OK. */
export async function deleteVisit(visitId: string): Promise<void> {
  try {
    await request("DELETE", `${profilePath}/visit/${encodeURIComponent(visitId)}`);
  } catch (err) {
    if (err instanceof WeAccessError && err.status === 404) return;
    throw err;
  }
}

/** Alle anlæggets døre (id + navn) - bruges af admin-diagnostikken. */
export async function listDoors(): Promise<unknown> {
  const { json } = await request("GET", `${profilePath}/doors`);
  return json;
}
