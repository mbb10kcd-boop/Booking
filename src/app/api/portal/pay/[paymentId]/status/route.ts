import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/db";
import { eq } from "drizzle-orm";
import { finalizePayment, currentPaymentState, type PaymentState } from "@/lib/payments";
import { isNexiEnabled, getNexiPayment } from "@/lib/nexi";

/**
 * Status for en betaling - kaldes af kundens retureside, mens den venter på at
 * Nexi melder "betalt". Er betalingen endnu ikke registreret hos os, spørger vi
 * Nexi direkte (webhooken kan komme lidt senere end kunden), og gennemfører
 * den hvis den er trukket. Returnerer kun det kunden selv skal se.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ paymentId: string }> }) {
  const { paymentId } = await params;
  const [payment] = await db.select().from(schema.payments).where(eq(schema.payments.id, paymentId));
  if (!payment) return NextResponse.json({ error: "Betaling ikke fundet" }, { status: 404 });

  if (payment.status === "annulleret") return NextResponse.json({ status: "annulleret" });

  let state: PaymentState | null = null;
  if (payment.status === "betalt") {
    state = await currentPaymentState(paymentId);
  } else if (isNexiEnabled() && payment.provider === "nexi" && payment.providerRef) {
    try {
      const n = await getNexiPayment(payment.providerRef);
      if (n.paid) state = await finalizePayment(paymentId);
    } catch (err) {
      console.error(`Nexi: kunne ikke hente betaling ${payment.providerRef}: ${err instanceof Error ? err.message : err}`);
    }
  }
  if (!state) return NextResponse.json({ status: "afventer" });

  return NextResponse.json({
    status: state.state === "conflict" ? "konflikt" : "betalt",
    accessCode: state.accessCode,
    accessCodeError: state.accessCodeError,
    bookings: state.bookings.map((b, i) => ({
      startsAt: b.startsAt,
      endsAt: b.endsAt,
      facilityName: state!.facilityNames[i],
    })),
  });
}
