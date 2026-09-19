/**
 * Genererer svartekster til bookingkommunikation. Bruges af indbakken og
 * konflikthåndteringen. Teksterne kan redigeres af administrator via
 * notification_templates senere; dette er fornuftige standardtekster.
 */

export function formatDaDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("da-DK", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

export function formatDaTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("da-DK", { hour: "2-digit", minute: "2-digit" });
}

export function confirmationMessage(opts: {
  facilityName: string;
  startsAt: string;
  endsAt: string;
  recipientName?: string;
}): string {
  return `Hej${opts.recipientName ? ` ${opts.recipientName}` : ""}

Din booking er bekræftet:

${opts.facilityName}
${formatDaDate(opts.startsAt)}
${formatDaTime(opts.startsAt)} - ${formatDaTime(opts.endsAt)}

Vi glæder os til at se jer.

Venlig hilsen
Grenaa Idrætscenter`;
}

export function rejectionMessage(opts: {
  facilityName: string;
  startsAt: string;
  endsAt: string;
  recipientName?: string;
}): string {
  return `Hej${opts.recipientName ? ` ${opts.recipientName}` : ""}

Tak for din forespørgsel om ${opts.facilityName} ${formatDaDate(opts.startsAt)} kl. ${formatDaTime(
    opts.startsAt
  )}-${formatDaTime(opts.endsAt)}.

Desværre er faciliteten allerede booket på det ønskede tidspunkt.

I er velkomne til at sende en ny forespørgsel med et alternativt tidspunkt.

Venlig hilsen
Grenaa Idrætscenter`;
}

export function displacedBookingMessage(opts: {
  organizationName?: string;
  facilityName: string;
  startsAt: string;
  endsAt: string;
}): string {
  return `Hej${opts.organizationName ? ` ${opts.organizationName}` : ""}

Jeres booking ${formatDaDate(opts.startsAt)} kl. ${formatDaTime(opts.startsAt)}-${formatDaTime(
    opts.endsAt
  )} i ${opts.facilityName} er desværre blevet ændret på grund af et andet arrangement.

Vi beklager ændringen.

Vi vender tilbage med forslag til en alternativ tid.

Venlig hilsen
Grenaa Idrætscenter`;
}

export function cancellationMessage(opts: {
  facilityName: string;
  startsAt: string;
  endsAt: string;
  recipientName?: string;
}): string {
  return `Hej${opts.recipientName ? ` ${opts.recipientName}` : ""}

Jeres booking er blevet aflyst:

${opts.facilityName}
${formatDaDate(opts.startsAt)}
${formatDaTime(opts.startsAt)} - ${formatDaTime(opts.endsAt)}

Kontakt os endelig, hvis I har spørgsmål, eller ønsker at booke en ny tid.

Venlig hilsen
Grenaa Idrætscenter`;
}

export function conflictExplanation(opts: {
  facilityName: string;
  startsAt: string;
  endsAt: string;
  existingOwner: string;
}): string {
  return `${formatDaDate(opts.startsAt)} kl. ${formatDaTime(opts.startsAt)}-${formatDaTime(
    opts.endsAt
  )} i ${opts.facilityName} er allerede booket af ${opts.existingOwner}.`;
}
