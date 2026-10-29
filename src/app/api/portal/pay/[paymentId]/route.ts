import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/db";
import { eq } from "drizzle-orm";
import { logAudit } from "@/lib/audit";
import { finalizePayment, currentPaymentState } from "@/lib/payments";
import { bookingsForPayment } from "@/lib/stalePayments";
import { isNexiEnabled, createNexiPayment, publicBaseUrl, NexiError } from "@/lib/nexi";
import { formatDaDate, formatDaTime } from "@/lib/ai/messages";

/**
 * Starter betalingen for en booking.
 *
 * Er Nexi slået til (NEXI_SECRET_KEY sat på serveren), oprettes en betaling hos
 * Nexi Checkout, og svaret er { redirectUrl } - kunden sendes til Nexis
 * betalingsside, hvor Dankort eller MobilePay vælges. Bookingen bekræftes først
 * når Nexi har meldt betalingen trukket (webhook eller retursiden - se
 * /api/portal/payment-webhook og /api/portal/pay/[id]/status).
 *
 * Er Nexi IKKE slået til, simuleres en vellykket betaling (til udvikling/
 * demonstration) - der trækkes ingen penge.
 *
 * Dækker BÅDE en almindelig enkelt-facilitet-booking (/api/portal/book) og
 * en bestilling af flere baner på én gang (/api/portal/book-group, som
 * peger betalingen på den FØRSTE booking i gruppen, jf. schema.ts) - i
 * sidstnævnte tilfælde bekræftes ALLE bookinger i samme multiBookingGroupId
 * og får samme adgangskode.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ paymentId: string }> }) {
  const { paymentId } = await params;
  const [payment] = await db.select().from(schema.payments).where(eq(schema.payments.id, paymentId));
  if (!payment) return NextResponse.json({ error: "Betaling ikke fundet" }, { status: 404 });

  if (payment.status === "betalt") {
    const state = await currentPaymentState(paymentId);
    return NextResponse.json({
      booking: state?.booking,
      bookings: state?.bookings,
      accessCode: state?.accessCode ?? null,
      accessCodeError: state?.accessCodeError ?? false,
    });
  }
  if (payment.status === "annulleret") {
    return NextResponse.json(
      { error: "Betalingen er udløbet, og tiden er frigivet. Start venligst bookingen forfra." },
      { status: 409 }
    );
  }

  if (!isNexiEnabled()) {
    const state = await finalizePayment(paymentId);
    return NextResponse.json({
      booking: state?.booking,
      bookings: state?.bookings,
      accessCode: state?.accessCode ?? null,
      accessCodeError: state?.accessCodeError ?? false,
    });
  }

  // --- Nexi: opret betaling og send kunden videre ---
  const { primary, group } = await bookingsForPayment(payment);
  if (!primary) return NextResponse.json({ error: "Booking ikke fundet" }, { status: 404 });
  const facilities = await db.select().from(schema.facilities);
  const nameOf = (facilityId: string) => facilities.find((f) => f.id === facilityId)?.name ?? "Booking";

  const items = group.map((b) => {
    const hours = (new Date(b.endsAt).getTime() - new Date(b.startsAt).getTime()) / 3_600_000;
    return {
      reference: b.id,
      name: `${nameOf(b.facilityId)} ${formatDaDate(b.startsAt)} kl. ${formatDaTime(b.startsAt)}-${formatDaTime(b.endsAt)}`,
      amountDkk: Math.round((b.price ?? 0) * hours * 100) / 100,
    };
  });

  const base = publicBaseUrl(req);
  try {
    const created = await createNexiPayment({
      reference: paymentId,
      items,
      totalDkk: payment.amount,
      returnUrl: `${base}/book/privat/betaling?payment=${encodeURIComponent(paymentId)}`,
      cancelUrl: `${base}/book/privat/betaling?payment=${encodeURIComponent(paymentId)}&afbrudt=1`,
      termsUrl: `${base}/book/vilkaar`,
      webhookUrl: `${base}/api/portal/payment-webhook`,
    });
    await db
      .update(schema.payments)
      .set({ provider: "nexi", providerRef: created.paymentId })
      .where(eq(schema.payments.id, paymentId));
    return NextResponse.json({ redirectUrl: created.hostedPaymentPageUrl });
  } catch (err) {
    const msg = err instanceof NexiError ? err.message : String(err);
    console.error(`Nexi: kunne ikke oprette betaling ${paymentId}: ${msg}`);
    await logAudit("booking", primary.id, "betaling_fejlet", `Kunne ikke starte betaling hos Nexi: ${msg}`);
    return NextResponse.json(
      { error: "Betalingen kunne ikke startes lige nu. Prøv igen om lidt - din tid holdes reserveret et kort stykke tid." },
      { status: 502 }
    );
  }
}
