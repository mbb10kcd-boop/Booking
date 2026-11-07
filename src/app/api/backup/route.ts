import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { timingSafeEqual } from "crypto";
import { getSessionUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * Fuld backup af databasen som JSON (alle tabeller + skema). Kræver login
 * eller headeren "Authorization: Bearer <BACKUP_TOKEN>" (miljøvariabel på Render, min. 32 tegn). Indeholder persondata og adgangskode-hashes -
 * gem filen krypteret/på en beskyttet placering. Bruges til manuel/ekstern
 * backup, fordi Turso's gratis plan kun kan gendanne 24 timer tilbage.
 */
function validBackupToken(req: Request): boolean {
  const expected = process.env.BACKUP_TOKEN;
  if (!expected || expected.length < 32) return false; // slået fra uden en lang nøgle
  const header = req.headers.get("authorization") ?? "";
  const given = header.startsWith("Bearer ") ? header.slice(7).trim() : (req.headers.get("x-backup-token") ?? "");
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(req: Request) {
  // Enten en indlogget bruger, eller den hemmelige nøgle BACKUP_TOKEN (til automatisk backup).
  const user = await getSessionUser();
  if (!user && !validBackupToken(req)) return NextResponse.json({ error: "Ikke logget ind" }, { status: 401 });

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
