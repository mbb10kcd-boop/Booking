import { db, schema } from "@/db";
import { and, eq, inArray, ne } from "drizzle-orm";
import { logAudit } from "@/lib/audit";
import { maybeCreateAccessCode, accessCodeExpected } from "@/lib/accessCodes";
import { findConflicts } from "@/lib/conflicts";
import { DOOR_EARLY_MINUTES } from "@/lib/doorConfig";
import { sendNotification } from "@/lib/mailer";
import { newId } from "@/lib/ids";
import { bookingsForPayment } from "@/lib/stalePayments";

type Booking = typeof schema.bookings.$inferSelect;

export interface PaymentState {
  /** "paid" = betalt og bekræftet; "conflict" = betalt, men tiden var nået at blive givet til andre. */
  state: "paid" | "conflict";
  booking: Booking | null;
  bookings: Booking[];
  accessCode: string | null;
  accessCodeError: boolean;
  facilityNames: string[];
}

/** Aktuel tilstand for en allerede gennemført betaling (ændrer intet). */
export async function currentPaymentState(paymentId: string): Promise<PaymentState | null> {
  const [payment] = await db.select().from(schema.payments).where(eq(schema.payments.id, paymentId));
  if (!payment) return null;
  const { primary, group } = await bookingsForPayment(payment);
  if (!primary) return null;
  const facilities = await db.select().from(schema.facilities);
  const facility = facilities.find((f) => f.id === primary.facilityId);
  const code = primary.accessCode ?? null;
  const revoked = primary.status === "aflyst";
  const accessCodeError =
    !code && !revoked && !!facility && accessCodeExpected({ organizationId: primary.organizationId, facility, allFacilities: facilities });
  return {
    state: revoked ? "conflict" : "paid",
    booking: primary,
    bookings: group,
    accessCode: code,
    accessCodeError,
    facilityNames: group.map((b) => facilities.find((f) => f.id === b.facilityId)?.name ?? "Ukendt facilitet"),
  };
}

const inflight = new Map<string, Promise<PaymentState | null>>();

/**
 * Gennemfører en betaling: markerer den betalt, bekræfter bookingerne, opretter
 * dørkoden og sender kvitteringen. Kaldes fra BÅDE Nexis webhook og fra
 * kundens retursiden - hvem der kommer først gør arbejdet; den anden får
 * blot den færdige tilstand (idempotent, også ved samtidige kald).
 *
 * Kaldes KUN når betalingen er verificeret (Nexi har meldt den trukket, eller
 * den simulerede betaling er trykket).
 */
export function finalizePayment(paymentId: string): Promise<PaymentState | null> {
  const existing = inflight.get(paymentId);
  if (existing) return existing;
  const p = doFinalize(paymentId).finally(() => inflight.delete(paymentId));
  inflight.set(paymentId, p);
  return p;
}

async function doFinalize(paymentId: string): Promise<PaymentState | null> {
  const [payment] = await db.select().from(schema.payments).where(eq(schema.payments.id, paymentId));
  if (!payment) return null;
  if (payment.status === "betalt") return currentPaymentState(paymentId);

  // "annulleret" tillades: kunden kan nå at betale, efter vi har frigivet tiden.
  const claim = await db
    .update(schema.payments)
    .set({ status: "betalt" })
    .where(and(eq(schema.payments.id, paymentId), ne(schema.payments.status, "betalt")));
  const affected = (claim as unknown as { rowsAffected?: number }).rowsAffected;
  if (affected !== undefined && affected === 0) return currentPaymentState(paymentId);

  const { primary: primaryBooking, group: groupBookings } = await bookingsForPayment(payment);
  if (!primaryBooking) return null;
  const groupBookingIds = groupBookings.map((b) => b.id);

  // Var tiden nået at blive frigivet (betalingen udløb), så tjek om den stadig er ledig.
  if (primaryBooking.status === "aflyst") {
    let blocked = false;
    for (const b of groupBookings) {
      // eslint-disable-next-line no-await-in-loop
      const conflicts = await findConflicts(b.facilityId, b.startsAt, b.endsAt, b.id);
      if (conflicts.length > 0) blocked = true;
    }
    if (blocked) {
      await logAudit(
        "booking",
        primaryBooking.id,
        "betaling_efter_udloeb",
        "Kunden har betalt, men tiden var nået at blive givet til en anden. Betalingen skal refunderes (kontakt kunden)."
      );
      return currentPaymentState(paymentId);
    }
    await logAudit("booking", primaryBooking.id, "betaling_efter_udloeb", "Betalt efter at tiden var frigivet - tiden var stadig ledig og er genoprettet.");
  }

  await db
    .update(schema.bookings)
    .set({ status: "betalt", paymentStatus: "betalt" })
    .where(inArray(schema.bookings.id, groupBookingIds));

  const facilityRows = await db
    .select()
    .from(schema.facilities)
    .where(inArray(schema.facilities.id, groupBookings.map((b) => b.facilityId)));
  const facilityById = new Map(facilityRows.map((f) => [f.id, f]));
  const referenceFacility = facilityById.get(primaryBooking.facilityId)!;
  const allFacilities = await db.select().from(schema.facilities);

  // Betalte bookinger (i praksis kun pickleball-/badmintonbanerne) er altid
  // privatpersoner - foreninger kan ikke booke dem (se hiddenFromOrgPortal) -
  // så den eneste afgørende faktor her er om lokalet har en kodedør, jf.
  // src/lib/accessCodes.ts. Banerne bruger Træningshallens dør, og deler
  // (ved en flerbane-bestilling) samme ÉN kode i stedet for én hver.
  const code = await maybeCreateAccessCode({
    bookingId: primaryBooking.id,
    organizationId: primaryBooking.organizationId,
    facility: referenceFacility,
    allFacilities,
    startsAt: primaryBooking.startsAt,
    endsAt: primaryBooking.endsAt,
  });
  // Betalingen er allerede gennemført, så bookingen rulles ikke tilbage - men
  // gæsten får besked om, at koden mangler, og fejlen står i bookinghistorikken.
  const accessCodeError =
    !code &&
    accessCodeExpected({ organizationId: primaryBooking.organizationId, facility: referenceFacility, allFacilities });
  if (code && groupBookingIds.length > 1) {
    await db
      .update(schema.bookings)
      .set({ accessCode: code })
      .where(inArray(schema.bookings.id, groupBookingIds.slice(1)));
  }

  const facilityNames = groupBookings.map((b) => facilityById.get(b.facilityId)?.name ?? "Ukendt facilitet");
  await sendNotification({
    id: newId("notif"),
    bookingId: primaryBooking.id,
    type: "betalingskvittering",
    recipient: primaryBooking.contactEmail ?? "ukendt",
    subject: code ? "Betaling modtaget - din adgangskode" : accessCodeError ? "Betaling modtaget - dørkode mangler" : "Betaling modtaget",
    body: code
      ? `Tak for din betaling (${facilityNames.join(", ")}). Din dørkode er ${code}, gyldig ${primaryBooking.startsAt} - ${primaryBooking.endsAt} (koden virker fra ${DOOR_EARLY_MINUTES} minutter før din tid starter).`
      : accessCodeError
        ? `Tak for din betaling (${facilityNames.join(", ")}). Vi kunne desværre ikke oprette din dørkode automatisk. Kontakt Grenaa Idrætscenter, så sender vi den hurtigst muligt - din tid er reserveret.`
        : `Tak for din betaling (${facilityNames.join(", ")}).`,
  });

  await logAudit("booking", primaryBooking.id, "betalt", code ? `Adgangskode ${code} genereret` : undefined);

  return currentPaymentState(paymentId);
}
