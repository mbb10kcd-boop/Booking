import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/db";
import { newId } from "@/lib/ids";

/**
 * Dagsnoter: fritekst-noter knyttet til en bestemt dato (fx "Tekniker kommer
 * til ventilationen kl. 10" eller "Brandøvelse i Fit og Sund"), uafhængige af
 * de almindelige bookinger - se schema.dayNotes. Vises både i kalenderen
 * (src/components/CalendarClient.tsx) og i pedelvisningen (via
 * /api/pedel/week, som slår dem sammen med ugens bookinger).
 *
 * ?from=&to= (begge "YYYY-MM-DD", inklusive) begrænser til et datointerval -
 * samme mønster som /api/bookings. Uden parametre returneres alle noter.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  let rows = await db.select().from(schema.dayNotes);
  if (from) rows = rows.filter((n) => n.date >= from);
  if (to) rows = rows.filter((n) => n.date <= to);
  rows.sort((a, b) => a.date.localeCompare(b.date) || (a.createdAt ?? "").localeCompare(b.createdAt ?? ""));

  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { date, text } = body;

  if (!date || !text) {
    return NextResponse.json({ error: "date og text er påkrævet" }, { status: 400 });
  }

  const note = {
    id: newId("note"),
    date,
    text,
    createdBy: body.createdBy ?? "Medarbejder",
  };
  await db.insert(schema.dayNotes).values(note);

  return NextResponse.json(note, { status: 201 });
}
