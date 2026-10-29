import { db, schema } from "@/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import { logAudit } from "@/lib/audit";
import { releaseDiscount } from "@/lib/discounts";

/** Hvor længe en tid holdes reserveret, mens kunden betaler (minutter). */
export const PAYMENT_HOLD_MINUTES = 45;

type Payment = typeof schema.payments.$inferSelect;

/** Alle bookinger en betaling dækker (én, eller hele flerbane-gruppen). */
export async function bookingsForPayment(payment: Payment) {
  const [primary] = await db.select().from(schema.bookings).where(eq(schema.bookings.id, payment.bookingId));
  if (!primary) return { primary: null, group: [] as (typeof schema.bookings.$inferSelect)[] };
  const group = primary.multiBookingGroupId
    ? await db.select().from(schema.bookings).where(eq(schema.bookings.multiBookingGroupId, primary.multiBookingGroupId))
    : [primary];
  return { primary, group };
}

/**
 * Frigiver tiden for en betaling der ikke blev gennemført (kunden afbrød,
 * eller betalingen udløb): bookingen aflyses STILLE (ingen aflysningsliste,
 * ingen mails - kunden nåede aldrig at få en bekræftet tid), betalingen
 * annulleres, og en brugt rabatkode gives tilbage. Gør intet hvis betalingen
 * allerede er gennemført eller allerede frigivet.
 */
export async function releaseUnpaidPayment(paymentId: string, reason: string): Promise<boolean> {
  const res = await db
    .update(schema.payments)
    .set({ status: "annulleret" })
    .where(and(eq(schema.payments.id, paymentId), eq(schema.payments.status, "afventer")));
  const affected = (res as unknown as { rowsAffected?: number }).rowsAffected;
  if (affected !== undefined && affected === 0) return false;

  const [payment] = await db.select().from(schema.payments).where(eq(schema.payments.id, paymentId));
  if (!payment) return false;
  const { primary, group } = await bookingsForPayment(payment);
  const ids = group.map((b) => b.id);
  if (ids.length > 0) {
    await db
      .update(schema.bookings)
      .set({ status: "aflyst", paymentStatus: "annulleret" })
      .where(and(inArray(schema.bookings.id, ids), eq(schema.bookings.status, "midlertidig")));
  }
  if (primary?.discountCode) {
    const [row] = await db.select().from(schema.discountCodes).where(eq(schema.discountCodes.code, primary.discountCode));
    if (row) await releaseDiscount(row);
  }
  if (primary) await logAudit("booking", primary.id, "betaling_frigivet", reason);
  return true;
}

let lastSweep = 0;

/**
 * Frigiver tider hvor kunden aldrig gennemførte betalingen (lukkede fanen,
 * mistede forbindelsen). Kaldes fra konflikt-/ledighedstjek, så en ubetalt
 * "midlertidig" booking ikke blokerer tiden for evigt. Kører højst hvert
 * minut pr. serverinstans.
 */
export async function releaseStaleUnpaid(): Promise<void> {
  const now = Date.now();
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  try {
    const stale = await db
      .select({ id: schema.payments.id })
      .from(schema.payments)
      .where(
        and(
          eq(schema.payments.status, "afventer"),
          sql`${schema.payments.createdAt} < datetime('now', ${`-${PAYMENT_HOLD_MINUTES} minutes`})`
        )
      );
    for (const p of stale) {
      // eslint-disable-next-line no-await-in-loop
      await releaseUnpaidPayment(p.id, `Betaling ikke gennemført inden ${PAYMENT_HOLD_MINUTES} minutter - tiden er frigivet`);
    }
  } catch (err) {
    console.error("releaseStaleUnpaid fejlede:", err);
  }
}
