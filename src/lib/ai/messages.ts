/**
 * Genererer svartekster til bookingkommunikation. Bruges af indbakken og
 * konflikthåndteringen. Teksterne kan redigeres af administrator via
 * notification_templates senere; dette er fornuftige standardtekster.
 */

import { weekdayName } from "@/lib/statusLabels";

export function formatDaDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("da-DK", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

/** Som `formatDaDate`, men uden årstal - bruges til dag-overskrifter i en uges program, hvor årstal er overflødigt. */
export function formatDaDateShort(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("da-DK", {
    weekday: "long",
    day: "2-digit",
    month: "long",
  });
}

/**
 * Sætter stort forbogstav på en dansk dato-streng uden at versalisere alle
 * ord - brug denne i stedet for CSS-klassen "capitalize" på output fra
 * formatDaDate/formatDaDateShort, da "capitalize" ellers fejlagtigt sætter
 * stort forbogstav på månedsnavnet også (fx "14. September", som er forkert
 * dansk retskrivning - det skal være "14. september").
 */
export function capitalizeDaDate(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
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
  /** Kun sat for privatpersoner der booker et lokale med kodedør (Træningshallen/Multisalen) - se src/lib/accessCodes.ts. */
  accessCode?: string | null;
}): string {
  return `Hej${opts.recipientName ? ` ${opts.recipientName}` : ""}

Din booking er bekræftet:

${opts.facilityName}
${formatDaDate(opts.startsAt)}
${formatDaTime(opts.startsAt)} - ${formatDaTime(opts.endsAt)}
${opts.accessCode ? `
Dørkode: ${opts.accessCode}
` : ""}
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

/**
 * Bekræftelsesbesked for en HEL sæsonbooking (flere ugentlige forekomster
 * oprettet på én gang, jf. `seasonGroupId`) - sendes kun ÉN gang for hele
 * sæsonen, i modsætning til `confirmationMessage` som er pr. enkelt booking.
 */
export function movedMessage(opts: {
  facilityName: string;
  startsAt: string;
  endsAt: string;
  recipientName?: string;
}): string {
  return `Hej${opts.recipientName ? ` ${opts.recipientName}` : ""}

Jeres booking er blevet flyttet til:

${opts.facilityName}
${formatDaDate(opts.startsAt)}
${formatDaTime(opts.startsAt)} - ${formatDaTime(opts.endsAt)}

Kontakt os endelig, hvis I har spørgsmål.

Venlig hilsen
Grenaa Idrætscenter`;
}

/**
 * Bekræftelsesbesked når en forening booker FLERE faciliteter på én gang i
 * foreningsportalen (samme dato/tidsrum, fx både et mødelokale og en hal) -
 * lister dem alle i én mail i stedet for én mail pr. facilitet.
 */
export function foreningBookingConfirmationMessage(opts: {
  organizationName: string;
  facilityNames: string[];
  startsAt: string;
  endsAt: string;
  note?: string;
}): string {
  return `Hej ${opts.organizationName}

Jeres booking er bekræftet:

${opts.facilityNames.map((n) => `- ${n}`).join("\n")}
${formatDaDate(opts.startsAt)}
${formatDaTime(opts.startsAt)} - ${formatDaTime(opts.endsAt)}
${opts.note ? `\nNote: ${opts.note}\n` : ""}
Vi glæder os til at se jer.

Venlig hilsen
Grenaa Idrætscenter`;
}

export function seasonConfirmationMessage(opts: {
  facilityName: string;
  weekday: number; // 0=søndag..6=lørdag, ligesom recurrenceRule.weekday
  startTime: string; // "HH:mm"
  endTime: string;
  until: string; // ISO dato
  occurrenceCount: number;
  recipientName?: string;
}): string {
  return `Hej${opts.recipientName ? ` ${opts.recipientName}` : ""}

Jeres sæsonbooking er bekræftet:

${opts.facilityName}
Hver ${weekdayName(opts.weekday).toLowerCase()} kl. ${opts.startTime.replace(":", ".")}-${opts.endTime.replace(":", ".")}
Frem til og med ${formatDaDate(`${opts.until}T00:00:00`)} (${opts.occurrenceCount} gange)

Vi glæder os til at se jer hele sæsonen.

Venlig hilsen
Grenaa Idrætscenter`;
}

/**
 * Aflysningsbesked når en HEL sæson stoppes (fra og med en given dato) i
 * stedet for kun én enkelt forekomst - se `cancellationMessage` for den.
 */
export function seasonCancellationMessage(opts: {
  facilityName: string;
  weekday: number;
  startTime: string;
  endTime: string;
  cancelledFrom: string; // ISO dato - resten af sæsonen fra og med denne dato er aflyst
  recipientName?: string;
}): string {
  return `Hej${opts.recipientName ? ` ${opts.recipientName}` : ""}

Jeres sæsonbooking er blevet aflyst fra og med ${formatDaDate(`${opts.cancelledFrom}T00:00:00`)}:

${opts.facilityName}
Hver ${weekdayName(opts.weekday).toLowerCase()} kl. ${opts.startTime.replace(":", ".")}-${opts.endTime.replace(":", ".")}

Kontakt os endelig, hvis I har spørgsmål.

Venlig hilsen
Grenaa Idrætscenter`;
}

/**
 * Besked når en HEL sæson (resten af den, fra og med en given dato) flyttes
 * til et nyt tidspunkt/ny ugedag og/eller ny facilitet på én gang - sendes
 * kun ÉN gang for hele sæsonen, i modsætning til `movedMessage` som er pr.
 * enkelt booking.
 */
export function seasonMovedMessage(opts: {
  facilityName: string;
  weekday: number;
  startTime: string;
  endTime: string;
  movedFrom: string; // ISO dato - resten af sæsonen fra og med denne dato er flyttet
  recipientName?: string;
}): string {
  return `Hej${opts.recipientName ? ` ${opts.recipientName}` : ""}

Jeres sæsonbooking er blevet flyttet fra og med ${formatDaDate(`${opts.movedFrom}T00:00:00`)} til:

${opts.facilityName}
Hver ${weekdayName(opts.weekday).toLowerCase()} kl. ${opts.startTime.replace(":", ".")}-${opts.endTime.replace(":", ".")}

Kontakt os endelig, hvis I har spørgsmål.

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

/**
 * Besked til en forening, når deres anmodning om at overtage en optaget tid
 * (indsendt via foreningsportalen, når den ønskede tid allerede var booket af
 * en anden forening) er blevet afvist af personalet - den eksisterende
 * booking forbliver uændret, og der sendes IKKE besked til den forening der
 * allerede havde tiden, da der intet ændrer sig for dem.
 */
export function rescheduleRejectedMessage(opts: {
  facilityNames: string[];
  startsAt: string;
  endsAt: string;
  organizationName: string;
}): string {
  return `Hej ${opts.organizationName}

Vi har desværre måttet afvise jeres anmodning om at overtage tiden:

${opts.facilityNames.map((n) => `- ${n}`).join("\n")}
${formatDaDate(opts.startsAt)}
${formatDaTime(opts.startsAt)} - ${formatDaTime(opts.endsAt)}

Den eksisterende booking i tidsrummet bliver stående. I er velkomne til at sende en ny anmodning med et andet tidspunkt eller en anden facilitet.

Venlig hilsen
Grenaa Idrætscenter`;
}
