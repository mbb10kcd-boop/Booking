import { NextResponse } from "next/server";
import { getExportCsv } from "@/lib/winkasLog";

export const dynamic = "force-dynamic";

/** Henter en tidligere log igen (præcis som den blev trukket). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const row = await getExportCsv(id);
  if (!row) return NextResponse.json({ error: "Ikke fundet" }, { status: 404 });
  const stamp = (row.createdAt ?? "").slice(0, 16).replace(/[: ]/g, "-");
  return new NextResponse(row.csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="winkas-log-${stamp}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
