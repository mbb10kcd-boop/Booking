import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/db";
import { and, eq, inArray } from "drizzle-orm";
import { logAudit } from "@/lib/audit";
import { localISODate } from "@/lib/date";

/**
 * Foreningsportalen: en forening markerer/afmarkerer egne eksisterende,
 * kommende bookinger som "VIGTIG/KAMP" (bookings.important). Portalen har
 * ingen login, så vi validerer at alle bookinger tilhører den godkendte
 * forening og stadig er aktive og kommende. Påvirker kun markeringen -
 * ingen mails, ingen ændring af tid.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json()) as { organizationId?: string; bookingIds?: string[]; important?: boolean };
  const { organizationId, bookingIds, important } = body;
  if (!organizationId || !Array.isArray(bookingIds) || bookingIds.length === 0 || typeof important !== "boolean") {
    return NextResponse.json({ error: "Ugyldig forespørgsel" }, { status: 400 });
  }
  if (bookingIds.length > 200) {
    return NextResponse.json({ error: "For mange bookinger på én gang" }, { status: 400 });
  }
  const [org] = await db.select().from(schema.organizations).where(eq(schema.organizations.id, organizationId));
  if (!org) return NextResponse.json({ error: "Forening ikke fundet" }, { status: 404 });
  if (org.status !== "godkendt") {
    return NextResponse.json({ error: "Jeres forening afventer stadig godkendelse" }, { status: 403 });
  }

  const rows = await db
    .select()
    .from(schema.bookings)
    .where(and(eq(schema.bookings.organizationId, organizationId), inArray(schema.bookings.id, bookingIds)));
  const today = localISODate();
  const valid = rows.filter(
    (b) => b.status !== "aflyst" && b.status !== "afvist" && b.startsAt.slice(0, 10) >= today && !!b.important !== important
  );
  const allowed = rows.filter((b) => b.status !== "aflyst" && b.status !== "afvist" && b.startsAt.slice(0, 10) >= today);
  if (allowed.length !== bookingIds.length) {
    return NextResponse.json({ error: "Nogle af tiderne kan ikke markeres (aflyst, passeret eller ikke jeres)" }, { status: 400 });
  }
  if (valid.length > 0) {
    await db
      .update(schema.bookings)
      .set({ important })
      .where(inArray(schema.bookings.id, valid.map((b) => b.id)));
    await logAudit(
      "booking",
      valid[0].id,
      important ? "markeret_vigtig" : "afmarkeret_vigtig",
      `${org.name} ${important ? "markerede" : "fjernede markering af"} ${valid.length} booking(er) som VIGTIG/KAMP via foreningsportalen`,
      org.name
    );
  }
  return NextResponse.json({ ok: true, changed: valid.length });
}
