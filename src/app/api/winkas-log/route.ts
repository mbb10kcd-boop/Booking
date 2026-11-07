import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { buildCsv, commitLog, getPendingLog, listExports, setBaseline, utcStamp } from "@/lib/winkasLog";

export const dynamic = "force-dynamic";

function csvResponse(csv: string, filename: string, extra: Record<string, string> = {}) {
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
      ...extra,
    },
  });
}

function fileName(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `winkas-log-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.csv`;
}

/**
 * GET: oversigt over hvad der er sket siden sidste log (ændrer intet).
 * GET ?format=csv: samme som fil - men uden at markere det som trukket.
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const includeAll = url.searchParams.get("includeAll") === "1";
  const pending = await getPendingLog(includeAll);
  if (url.searchParams.get("format") === "csv") {
    return csvResponse(buildCsv(pending.rows), fileName());
  }
  const exports = await listExports();
  return NextResponse.json({
    baseline: pending.baseline,
    counts: pending.counts,
    rows: pending.rows,
    exports,
  });
}

/**
 * POST { action: "export", includeAll } : henter loggen som CSV OG markerer
 * bookingerne som overført til Winkas (næste log viser kun det nye).
 * POST { action: "baseline", date: "YYYY-MM-DD" } : sætter hvor langt tilbage loggen skal kigge efter nye bookinger.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { action?: string; includeAll?: boolean; date?: string };
  if (body.action === "baseline") {
    if (!body.date || !/^\d{4}-\d{2}-\d{2}$/.test(body.date)) {
      return NextResponse.json({ error: "Ugyldig dato" }, { status: 400 });
    }
    // Midnat dansk tid ~ aftenen før i UTC; lidt for tidligt er hellere end for sent.
    const utc = utcStamp(new Date(`${body.date}T00:00:00+01:00`));
    await setBaseline(utc);
    return NextResponse.json({ ok: true, baseline: utc });
  }
  if (body.action === "export") {
    const pending = await getPendingLog(!!body.includeAll);
    if (pending.rows.length === 0) {
      return NextResponse.json({ error: "Der er intet nyt siden sidste log." }, { status: 409 });
    }
    const csv = buildCsv(pending.rows);
    const user = await getSessionUser();
    const exportId = await commitLog(pending, csv, user?.name ?? "Ukendt");
    return csvResponse(csv, fileName(), { "X-Export-Id": exportId });
  }
  return NextResponse.json({ error: "Ukendt handling" }, { status: 400 });
}
