/**
 * Datohjælpefunktioner.
 *
 * VIGTIGT: Grenaa Idrætscenter er ét fysisk sted i én tidszone
 * (Europe/Copenhagen). Bookinger gemmes derfor bevidst som "naive" lokale
 * klokkeslæt-strenge (fx "2026-10-17T18:00:00") UDEN tidszone-suffix ("Z"),
 * og ALDRIG via Date#toISOString() (som konverterer til UTC og derved
 * forskyder klokkeslættet med den lokale offset - en klassisk kilde til
 * fejl omkring midnat og ved sommer/vintertidsskift). Al datoregning bruger
 * derfor lokale getters (getFullYear/getMonth/getDate/getDay/getHours),
 * aldrig UTC-varianterne eller toISOString().
 *
 * Ved fremtidig drift skal serverens TZ sættes til Europe/Copenhagen.
 */

export function localISODate(d: Date = new Date()): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function combineDateAndTime(dateISO: string, time: string): string {
  return `${dateISO}T${time}:00`;
}

/** Nuværende tidspunkt som naiv lokal streng, samme format som gemte bookinger */
export function nowLocalDateTimeString(d: Date = new Date()): string {
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${localISODate(d)}T${hh}:${mm}:${ss}`;
}

export function addDays(d: Date, days: number): Date {
  const copy = new Date(d);
  copy.setDate(copy.getDate() + days);
  return copy;
}
