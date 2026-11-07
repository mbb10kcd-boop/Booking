import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getSessionUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * Fuld backup af databasen som JSON (alle tabeller + skema). Kræver login
 * (middleware + sessionstjek). Indeholder persondata og adgangskode-hashes -
 * gem filen krypteret/på en beskyttet placering. Bruges til manuel/ekstern
 * backup, fordi Turso's gratis plan kun kan gendanne 24 timer tilbage.
 */
export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Ikke logget ind" }, { status: 401 });

  const master = (await db.all(
    sql`SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_litestream%' AND name NOT LIKE 'libsql_%' ORDER BY name`
  )) as { name: string; sql: string }[];

  const tables: Record<string, unknown[]> = {};
  const counts: Record<string, number> = {};
  for (const t of master) {
    const rows = (await db.all(sql.raw(`SELECT * FROM "${t.name.replace(/"/g, '""')}"`))) as unknown[];
    tables[t.name] = rows;
    counts[t.name] = rows.length;
  }

  const body = JSON.stringify({
    exportedAt: new Date().toISOString(),
    counts,
    schema: Object.fromEntries(master.map((t) => [t.name, t.sql])),
    tables,
  });
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  const name = `booking-backup-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.json`;
  return new NextResponse(body, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
    },
  });
}
