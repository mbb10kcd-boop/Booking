import { NextResponse } from "next/server";
import { isWeAccessEnabled, listDoors, WeAccessError } from "@/lib/weaccess";

/**
 * Admin-diagnostik for WeAccess-integrationen (kræver login, jf.
 * middleware.ts - ligger bevidst IKKE under /api/portal/). Viser om
 * integrationen er slået til og forsøger at hente anlæggets døre, så man kan
 * se at forbindelsen, nøglen og dør-id'erne virker. Skriver aldrig noget på
 * låsene og afslører aldrig API-nøglen.
 */
export async function GET() {
  if (!isWeAccessEnabled()) {
    return NextResponse.json({
      enabled: false,
      message: "WEACCESS_API_KEY er ikke sat på serveren - systemet bruger den faste kodepulje.",
    });
  }
  try {
    const doors = await listDoors();
    return NextResponse.json({ enabled: true, ok: true, doors });
  } catch (err) {
    const status = err instanceof WeAccessError ? err.status : 0;
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ enabled: true, ok: false, upstreamStatus: status, error: message }, { status: 502 });
  }
}
