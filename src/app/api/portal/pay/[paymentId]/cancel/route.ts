import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/db";
import { eq } from "drizzle-orm";
import { finalizePayment } from "@/lib/payments";
import { releaseUnpaidPayment } from "@/lib/stalePayments";
import { isNexiEnabled, getNexiPayment } from "@/lib/nexi";

/**
 * Kunden afbrød betalingen hos Nexi. Tiden frigives, så andre kan booke den -
 * men først efter et sidste tjek hos Nexi: har kunden alligevel betalt (fx
 * trykkede "tilbage" for sent), gennemføres bookingen i stedet.
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ paymentId: string }> }) {
  const { paymentId } = await params;
  const [payment] = await db.select().from(schema.payments).where(eq(schema.payments.id, paymentId));
  if (!payment) return NextResponse.json({ error: "Betaling ikke fundet" }, { status: 404 });
  if (payment.status !== "afventer") return NextResponse.json({ status: payment.status });

  if (isNexiEnabled() && payment.provider === "nexi" && payment.providerRef) {
    try {
      const n = await getNexiPayment(payment.providerRef);
      if (n.paid) {
        await finalizePayment(paymentId);
        return NextResponse.json({ status: "betalt" });
      }
    } catch {
      // Kan vi ikke spørge Nexi, lader vi tiden stå - den frigives automatisk efter udløb.
      return NextResponse.json({ status: "afventer" });
    }
  }
  await releaseUnpaidPayment(paymentId, "Kunden afbrød betalingen - tiden er frigivet");
  return NextResponse.json({ status: "annulleret" });
}
