import { db, schema } from "@/db";
import { and, eq, sql, or, isNull, lt } from "drizzle-orm";
import { localISODate } from "@/lib/date";

export type DiscountRow = typeof schema.discountCodes.$inferSelect;

export function normalizeCode(code: unknown): string {
  return String(code ?? "").trim().toUpperCase().replace(/\s+/g, "");
}

/** Rabat i kr. af et samlet beløb (procent først, så fast beløb), aldrig over beløbet. */
export function computeDiscount(row: DiscountRow, total: number): number {
  let discount = 0;
  if (row.percentOff && row.percentOff > 0) discount += (total * Math.min(row.percentOff, 100)) / 100;
  if (row.amountOff && row.amountOff > 0) discount += row.amountOff;
  discount = Math.min(discount, total);
  return Math.round(discount * 100) / 100;
}

export type DiscountCheck =
  | { ok: true; row: DiscountRow; discount: number; finalTotal: number }
  | { ok: false; error: string };

const GENERIC_ERROR = "Rabatkoden findes ikke eller kan ikke bruges";

/** Slår koden op og tjekker aktiv/periode/antal. Reserverer IKKE en brug (se redeemDiscount). */
export async function checkDiscountCode(rawCode: unknown, total: number): Promise<DiscountCheck> {
  const code = normalizeCode(rawCode);
  if (!code) return { ok: false, error: "Indtast en rabatkode" };
  const [row] = await db.select().from(schema.discountCodes).where(eq(schema.discountCodes.code, code));
  if (!row || !row.active) return { ok: false, error: GENERIC_ERROR };
  const today = localISODate();
  if (row.validFrom && today < row.validFrom) return { ok: false, error: "Rabatkoden kan ikke bruges endnu" };
  if (row.validUntil && today > row.validUntil) return { ok: false, error: "Rabatkoden er udløbet" };
  if (row.maxUses !== null && row.maxUses !== undefined && row.usedCount >= row.maxUses) {
    return { ok: false, error: "Rabatkoden er allerede brugt" };
  }
  const discount = computeDiscount(row, total);
  if (discount <= 0) return { ok: false, error: GENERIC_ERROR };
  return { ok: true, row, discount, finalTotal: Math.round((total - discount) * 100) / 100 };
}

/** Bruger én indløsning atomisk (undgår at to samtidige bookinger bruger sidste gang). */
export async function redeemDiscount(row: DiscountRow): Promise<boolean> {
  const res = await db
    .update(schema.discountCodes)
    .set({ usedCount: sql`${schema.discountCodes.usedCount} + 1` })
    .where(
      and(
        eq(schema.discountCodes.id, row.id),
        or(isNull(schema.discountCodes.maxUses), lt(schema.discountCodes.usedCount, schema.discountCodes.maxUses))
      )
    );
  const affected = (res as unknown as { rowsAffected?: number }).rowsAffected;
  return affected === undefined ? true : affected > 0;
}

/** Gives en indløsning tilbage (fx hvis bookingen ikke kunne oprettes alligevel). */
export async function releaseDiscount(row: DiscountRow): Promise<void> {
  await db
    .update(schema.discountCodes)
    .set({ usedCount: sql`MAX(${schema.discountCodes.usedCount} - 1, 0)` })
    .where(eq(schema.discountCodes.id, row.id));
}

// Enkel throttling pr. IP mod gætte-angreb på koder (i hukommelsen; nok her).
const attempts = new Map<string, { n: number; reset: number }>();
export function throttle(ip: string, limit = 30, windowMs = 10 * 60_000): boolean {
  const now = Date.now();
  const cur = attempts.get(ip);
  if (!cur || cur.reset < now) {
    attempts.set(ip, { n: 1, reset: now + windowMs });
    return true;
  }
  cur.n += 1;
  return cur.n <= limit;
}
