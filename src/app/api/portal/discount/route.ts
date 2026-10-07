import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/db";
import { inArray } from "drizzle-orm";
import { checkDiscountCode, throttle } from "@/lib/discounts";

/**
 * Privatportalen: tjek en rabatkode mod den aktuelle bestilling og vis hvad
 * den giver. Intet reserveres her - selve indløsningen sker først, når
 * bookingen oprettes (/api/portal/book og /book-group).
 */
export async function POST(req: NextRequest) {
  const ip = (req.headers.get("x-forwarded-for") ?? "ukendt").split(",")[0].trim();
  if (!throttle(ip)) {
    return NextResponse.json({ error: "For mange forsøg - prøv igen om lidt" }, { status: 429 });
  }
  const { code, facilityIds, startsAt, endsAt } = (await req.json()) as {
    code?: string;
    facilityIds?: string[];
    startsAt?: string;
    endsAt?: string;
  };
  if (!Array.isArray(facilityIds) || facilityIds.length === 0 || !startsAt || !endsAt) {
    return NextResponse.json({ error: "Ugyldig forespørgsel" }, { status: 400 });
  }
  const facilities = await db.select().from(schema.facilities).where(inArray(schema.facilities.id, facilityIds));
  const hours = (new Date(endsAt).getTime() - new Date(startsAt).getTime()) / 3_600_000;
  const total = Math.round(facilities.reduce((sum, f) => sum + (f.pricePerHour ?? 0), 0) * hours * 100) / 100;
  if (total <= 0) {
    return NextResponse.json({ error: "Denne booking er allerede gratis - rabatkode er ikke nødvendig" }, { status: 400 });
  }
  const check = await checkDiscountCode(code, total);
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: 400 });
  return NextResponse.json({
    code: check.row.code,
    label: check.row.label,
    total,
    discount: check.discount,
    finalTotal: check.finalTotal,
  });
}
