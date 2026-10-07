import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/db";
import { desc } from "drizzle-orm";
import { newId } from "@/lib/ids";
import { logAudit } from "@/lib/audit";
import { normalizeCode } from "@/lib/discounts";

/** Personalet: rabatkoder (kræver login via middleware). */
export async function GET() {
  const rows = await db.select().from(schema.discountCodes).orderBy(desc(schema.discountCodes.createdAt));
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const code = normalizeCode(body.code);
  if (!/^[A-Z0-9ÆØÅ_-]{3,40}$/.test(code)) {
    return NextResponse.json({ error: "Koden skal være 3-40 tegn: bogstaver, tal, - eller _" }, { status: 400 });
  }
  const percentOff = body.percentOff === "" || body.percentOff == null ? null : Number(body.percentOff);
  const amountOff = body.amountOff === "" || body.amountOff == null ? null : Number(body.amountOff);
  if (
    (percentOff === null && amountOff === null) ||
    (percentOff !== null && (!(percentOff > 0) || percentOff > 100)) ||
    (amountOff !== null && !(amountOff > 0))
  ) {
    return NextResponse.json({ error: "Angiv enten procent (1-100) eller et fast beløb i kr." }, { status: 400 });
  }
  const maxUses = body.maxUses === "" || body.maxUses == null ? null : Math.floor(Number(body.maxUses));
  if (maxUses !== null && !(maxUses > 0)) {
    return NextResponse.json({ error: "Antal brug skal være et positivt tal (eller tomt for ubegrænset)" }, { status: 400 });
  }
  try {
    const id = newId("disc");
    await db.insert(schema.discountCodes).values({
      id,
      code,
      label: body.label?.trim() || null,
      percentOff,
      amountOff,
      maxUses,
      validFrom: body.validFrom || null,
      validUntil: body.validUntil || null,
      active: true,
    });
    await logAudit("discount_code", id, "oprettet", `Rabatkode ${code} oprettet`);
    return NextResponse.json({ id }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Der findes allerede en rabatkode med det navn" }, { status: 409 });
  }
}
