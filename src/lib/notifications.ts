import { db, schema } from "@/db";
import { eq } from "drizzle-orm";
import { newId } from "@/lib/ids";
import { cancellationMessage, movedMessage } from "@/lib/ai/messages";
import { sendNotification } from "@/lib/mailer";

/**
 * Finder alle mailadresser en besked om en given booking skal sendes til:
 * foreningens AKTUELLE kontaktmail (slået op friskt her - IKKE en kopi fra
 * booking-oprettelsen), bookingens egen kontaktmail (hvis den afviger fra
 * foreningens, fx en enkeltstående anden kontakt for netop denne booking) og
 * en eventuel ekstra mail tilføjet via foreningsportalen (se extraEmail i
 * schema.ts) - dubletter fjernes. At slå foreningens mail op friskt betyder,
 * at hvis en forkert/forældet mailadresse rettes i /foreninger, bruges den
 * rettede adresse automatisk for ALLE fremtidige aflysninger/flytninger -
 * uden at skulle rette hver enkelt booking. Delt mellem den almindelige
 * booking-redigering (src/app/api/bookings/[id]/route.ts), aflysning af en
 * hel sæson (src/app/api/bookings/season/[seasonGroupId]/route.ts) og
 * godkendelse af anmodninger om aflysning/flytning
 * (src/app/api/reschedule-requests/[id]/route.ts).
 */
export async function resolveNotificationRecipients(booking: typeof schema.bookings.$inferSelect): Promise<string[]> {
  let orgEmail: string | null = null;
  if (booking.organizationId) {
    const [org] = await db.select().from(schema.organizations).where(eq(schema.organizations.id, booking.organizationId));
    orgEmail = org?.contactEmail ?? null;
  }
  const recipients = [orgEmail, booking.contactEmail, booking.extraEmail].filter((r): r is string => !!r);
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
    await sendNotification({
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
    await sendNotification({
      id: newId("notif"),
      bookingId: updated.id,
      type: "aendring",
      recipient,
      subject: "Jeres booking er flyttet",
      body: message,
    });
  }
}
