import { addDays, localISODate } from "@/lib/date";

/**
 * Hjælpere til bookinger der løber over flere dage (fx en turnering som Mini
 * Cup fra tirsdag kl. 8 til fredag kl. 16). En sådan booking skal vises på
 * HVER dag den optager - ikke kun på startdagen. Alle tider er "naive" lokale
 * strenge "YYYY-MM-DDTHH:mm:ss".
 */
type Span = { startsAt: string; endsAt: string };

/** Sidste kalenderdag bookingen optager (slutter den præcis kl. 00.00, optager den ikke slutdagen). */
export function bookingLastDay(b: Span): string {
  const startDay = b.startsAt.slice(0, 10);
  const endDay = b.endsAt.slice(0, 10);
  if (endDay > startDay && b.endsAt.slice(11, 16) === "00:00") {
    return localISODate(addDays(new Date(`${endDay}T00:00:00`), -1));
  }
  return endDay < startDay ? startDay : endDay;
}

export function isMultiDay(b: Span): boolean {
  return bookingLastDay(b) > b.startsAt.slice(0, 10);
}

/** Optager bookingen (helt eller delvist) kalenderdagen `dayStr` (YYYY-MM-DD)? */
export function bookingOnDay(b: Span, dayStr: string): boolean {
  return b.startsAt.slice(0, 10) <= dayStr && dayStr <= bookingLastDay(b);
}

const hhmm = (iso: string) => iso.slice(11, 16).replace(":", ".");

/** Tidstekst for en booking på en bestemt dag: "08.00-16.00", eller ved flerdagsbookinger "fra 08.00" / "hele dagen" / "til 16.00". */
export function dayTimeLabel(b: Span, dayStr: string): string {
  if (!isMultiDay(b)) return `${hhmm(b.startsAt)}-${hhmm(b.endsAt)}`;
  if (dayStr === b.startsAt.slice(0, 10)) return `fra ${hhmm(b.startsAt)}`;
  if (dayStr === bookingLastDay(b) && b.endsAt.slice(0, 10) === dayStr) return `til ${hhmm(b.endsAt)}`;
  return "hele dagen";
}
