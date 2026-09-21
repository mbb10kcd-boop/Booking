import { db, schema } from "@/db";
import { eq } from "drizzle-orm";
import { newId } from "@/lib/ids";
import { cancellationMessage, movedMessage } from "@/lib/ai/messages";

/**
 * Finder alle mailadresser en besked om en given booking skal sendes til: den
 * registrerede kontaktmail (eller foreningens, hvis bookingen ikke selv har
 * en) OG en eventuel ekstra mail tilføjet via foreningsportalen (se
 * extraEmail i schema.ts) - dubletter fjernes. Delt mellem den almindelige
 * booking-redigering (src/app/api/bookings/[id]/route.ts) og godkendelse af
 * anmodninger om aflysning/flytning (src/app/api/reschedule-requests/[id]/route.ts).
 */
export async function resolveNotificationRecipients(booking: typeof schema.bookings.$inferSelect): Promise<string[]> {
  let primary = booking.contactEmail;
  if (!primary && booking.organizationId) {
    const [org] = await db.select().from(schema.organizations).where(eq(schema.organizations.id, booking.organizationId));
    primary = org?.contactEmail ?? null;
  }
  const recipients = [primary, booking.extraEmail].filter((r): r is string => !!r);
  return Array.from(new Set(recipients));
}

/**
 * Sender (simuleret) aflysningsmail til bookingens kontakt(er) - se
 * resolveNotificationRecipients.
 */
export async function notifyCancellation(booking: typeof schema.bookings.$inferSelect) {
  const recipients = await resolveNotificationRecipients(booking);
  if (recipients.length === 0) return;

  const [facility] = await db.select().from(schema.facilities).where(eq(schema.facilities.id, booking.facilityId));
  const message = cancellationMessage({
    facilityName: facility?.name ?? "faciliteten",
    startsAt: booking.startsAt,
    endsAt: booking.endsAt,
    recipientName: booking.contactName ?? undefined,
  });
  for (const recipient of recipients) {
    await db.insert(schema.notificationLog).values({
      id: newId("notif"),
      bookingId: booking.id,
      type: "aflysning",
      recipient,
      subject: "Aflysning af jeres booking",
      body: message,
    });
  }
}

/**
 * Sender (simuleret) besked om at bookingen er flyttet til nyt tidspunkt
 * og/eller ny facilitet, til bookingens kontakt(er) - se
 * resolveNotificationRecipients. `updated` er bookingen EFTER flytningen.
 */
export async function notifyMove(updated: typeof schema.bookings.$inferSelect) {
  const recipients = await resolveNotificationRecipients(updated);
  if (recipients.length === 0) return;

  const [facility] = await db.select().from(schema.facilities).where(eq(schema.facilities.id, updated.facilityId));
  const message = movedMessage({
    facilityName: facility?.name ?? "faciliteten",
    startsAt: updated.startsAt,
    endsAt: updated.endsAt,
    recipientName: updated.contactName ?? undefined,
  });
  for (const recipient of recipients) {
    await db.insert(schema.notificationLog).values({
      id: newId("notif"),
      bookingId: updated.id,
      type: "aendring",
      recipient,
      subject: "Jeres booking er flyttet",
      body: message,
    });
  }
}
