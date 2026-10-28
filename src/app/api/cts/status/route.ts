import { NextRequest, NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "crypto";
import { loadActiveBookingsBetween } from "@/lib/conflicts";
import { getAllFacilities } from "@/lib/facilities";
import { addDays, nowLocalDateTimeString } from "@/lib/date";
import { computeCtsStatus, DEFAULT_EXCLUDED_STATUSES } from "@/lib/ctsStatus";

export const dynamic = "force-dynamic";

/**
 * Lysstyring (CTS) - status pr. lyszone.
 *
 *   GET /api/cts/status                      -> JSON med alle zoner
 *   GET /api/cts/status?zone=<id>            -> JSON for én zone
 *   GET /api/cts/status?zone=<id>&format=text -> kun "ON" eller "OFF" (nemt til scripts)
 *   GET /api/cts/status?format=text          -> én linje pr. zone: "<id>=ON"
 *   GET /api/cts/status?zone=<id>&format=lux -> kun lysniveauet som tal: 0 (slukket), 400, 700 eller 1000
 *   GET /api/cts/status?format=lux           -> én linje pr. zone: "<id>=700"
 *
 * Godkendelse: API-nøglen (miljøvariablen CTS_API_KEY på Render) sendes som
 *   Authorization: Bearer <nøgle>        eller
 *   Authorization: Basic base64(<valgfrit brugernavn>:<nøgle>)   eller
 *   X-API-Key: <nøgle>
 *
 * Valgfrie indstillinger (Render-miljøvariabler, kan overstyres pr. kald til test):
 *   CTS_LEAD_MINUTES  minutter lyset tændes FØR en booking (standard 15)  - ?lead=
 *   CTS_LAG_MINUTES   minutter lyset er tændt EFTER en booking (standard 15) - ?lag=
 *   CTS_EXCLUDED_STATUSES  kommasepareret liste af statusser der ikke tænder lyset
 *   CTS_ZONES         kommasepareret liste af zone-id'er der vises (standard: alle), fx "traeningshallen"
 */

function sha(s: string) {
  return createHash("sha256").update(s).digest();
}

function extractKey(req: NextRequest): string {
  const auth = req.headers.get("authorization") ?? "";
  if (/^bearer\s+/i.test(auth)) return auth.replace(/^bearer\s+/i, "").trim();
  if (/^basic\s+/i.test(auth)) {
    try {
      const decoded = Buffer.from(auth.replace(/^basic\s+/i, "").trim(), "base64").toString("utf8");
      const idx = decoded.indexOf(":");
      return idx >= 0 ? decoded.slice(idx + 1) : decoded;
    } catch {
      return "";
    }
  }
  return (req.headers.get("x-api-key") ?? "").trim();
}

function num(v: string | null | undefined, fallback: number): number {
  const n = v !== null && v !== undefined && v !== "" ? Number(v) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(180, Math.max(0, Math.round(n)));
}

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(req: NextRequest) {
  const expected = (process.env.CTS_API_KEY ?? "").trim().split(/\s+/)[0] ?? "";
  if (!expected) {
    return NextResponse.json({ error: "CTS-API'et er ikke aktiveret (CTS_API_KEY er ikke sat)" }, { status: 503, headers: NO_STORE });
  }
  const given = extractKey(req);
  if (!given || !timingSafeEqual(sha(given), sha(expected))) {
    return NextResponse.json({ error: "Ugyldig eller manglende API-nøgle" }, { status: 401, headers: { ...NO_STORE, "WWW-Authenticate": 'Basic realm="cts"' } });
  }

  const sp = req.nextUrl.searchParams;
  const lead = num(sp.get("lead"), num(process.env.CTS_LEAD_MINUTES, 15));
  const lag = num(sp.get("lag"), num(process.env.CTS_LAG_MINUTES, 15));
  const excluded = process.env.CTS_EXCLUDED_STATUSES
    ? process.env.CTS_EXCLUDED_STATUSES.split(",").map((s) => s.trim()).filter(Boolean)
    : DEFAULT_EXCLUDED_STATUSES;

  const now = new Date();
  const nowNaive = nowLocalDateTimeString(now);
  // Hent bookinger der overlapper fra i går til en uge frem (så også igangværende flerdagsbookinger og "næste vindue" er med).
  const day = nowNaive.slice(0, 10);
  const fromYesterday = `${addIso(day, -1)}T00:00:00`;
  const to = `${addIso(day, 8)}T00:00:00`;
  const [facilities, bookings] = await Promise.all([getAllFacilities(), loadActiveBookingsBetween(fromYesterday, to)]);

  let zones = computeCtsStatus({
    facilities,
    bookings,
    nowNaive,
    leadMinutes: lead,
    lagMinutes: lag,
    excludedStatuses: excluded,
  });

  // CTS_ZONES (Render) begrænser hvilke zoner API'et overhovedet viser, fx "traeningshallen".
  const allowedZones = (process.env.CTS_ZONES ?? "").split(",").map((z) => z.trim().toLowerCase()).filter(Boolean);
  if (allowedZones.length > 0) zones = zones.filter((z) => allowedZones.includes(z.id));

  const zoneParam = sp.get("zone");
  if (zoneParam) {
    zones = zones.filter((z) => z.id === zoneParam.toLowerCase());
    if (zones.length === 0) {
      return NextResponse.json({ error: `Ukendt zone "${zoneParam}"` }, { status: 404, headers: NO_STORE });
    }
  }

  if (sp.get("format") === "lux") {
    const body = zoneParam ? String(zones[0].lux) : zones.map((z) => `${z.id}=${z.lux}`).join("\n");
    return new NextResponse(body + "\n", { headers: { ...NO_STORE, "Content-Type": "text/plain; charset=utf-8" } });
  }

  if (sp.get("format") === "text") {
    const body = zoneParam ? zones[0].light : zones.map((z) => `${z.id}=${z.light}`).join("\n");
    return new NextResponse(body + "\n", { headers: { ...NO_STORE, "Content-Type": "text/plain; charset=utf-8" } });
  }

  return NextResponse.json(
    {
      generatedAt: now.toISOString(),
      localTime: nowNaive,
      timezone: "Europe/Copenhagen",
      leadMinutes: lead,
      lagMinutes: lag,
      zones,
    },
    { headers: NO_STORE }
  );
}

/** Lægger dage til en "YYYY-MM-DD"-streng uden tidszoneproblemer. */
function addIso(dateStr: string, days: number): string {
  const d = addDays(new Date(`${dateStr}T00:00:00`), days);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
