import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/db";
import { eq } from "drizzle-orm";
import { finalizePayment } from "@/lib/payments";
import { getNexiPayment, isNexiEnabled, nexiWebhookSecret } from "@/lib/nexi";

/**
 * Webhook fra Nexi Checkout (event payment.checkout.completed): kunden har
 * gennemført betalingen. Vi stoler ikke blindt på selve kaldet - vi slår
 * betalingen op hos Nexi og gennemfører først bookingen, når Nexi selv siger
 * at beløbet er trukket. Kaldet godkendes med Authorization-headeren
 * (NEXI_WEBHOOK_SECRET), som vi selv bad Nexi sende med.
 */
export async function POST(req: NextRequest) {
  if (!isNexiEnabled()) return NextResponse.json({ error: "Nexi er ikke slået til" }, { status: 404 });

  const secret = nexiWebhookSecret();
  if (secret && req.headers.get("authorization") !== secret) {
    return NextResponse.json({ error: "Ikke godkendt" }, { status: 401 });
  }

  let body: { data?: { paymentId?: string } } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Ugyldigt indhold" }, { status: 400 });
  }
  const nexiPaymentId = body?.data?.paymentId;
  if (!nexiPaymentId || typeof nexiPaymentId !== "string") {
    return NextResponse.json({ error: "paymentId mangler" }, { status: 400 });
  }

  const [payment] = await db.select().from(schema.payments).where(eq(schema.payments.providerRef, nexiPaymentId));
  // Ukendt betaling: svar 200 så Nexi ikke bliver ved med at prøve igen.
  if (!payment) return NextResponse.json({ ok: true, ignored: true });

  try {
    const n = await getNexiPayment(nexiPaymentId);
    if (n.paid) await finalizePayment(payment.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(`Nexi webhook: kunne ikke behandle ${nexiPaymentId}: ${err instanceof Error ? err.message : err}`);
    // 500 -> Nexi prøver igen senere.
    return NextResponse.json({ error: "Midlertidig fejl" }, { status: 500 });
  }
}
