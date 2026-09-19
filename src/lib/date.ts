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

/**
 * Runder et klokkeslæt ("HH:mm") til nærmeste multiplum af `stepMinutes`
 * (standard 10 min). Beslutning: bookingtider skal altid lande på hele
 * 10-minutters-intervaller (fx 15:50 eller 16:00, aldrig 15:51) - dels fordi
 * browserens indbyggede tidsvælger ellers kræver at rulle igennem alle 60
 * minuttal, dels fordi det matcher hvordan tiderne faktisk bruges i praksis.
 * Bruges sammen med `step={stepMinutes * 60}` på <input type="time">, som
 * gør at klik på op/ned-pilene i sig selv springer 10 minutter ad gangen;
 * denne funktion retter derudover op på tastede/indsatte "skæve" tider.
 */
export function roundTimeString(time: string, stepMinutes = 10): string {
  const [hh, mm] = time.split(":").map(Number);
  if (Number.isNaN(hh) || Number.isNaN(mm)) return time;
  const total = ((Math.round((hh * 60 + mm) / stepMinutes) * stepMinutes) % 1440 + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/** Samme afrunding som `roundTimeString`, men for en rå datetime-local-værdi ("YYYY-MM-DDTHH:mm"). */
export function roundDateTimeLocalString(value: string, stepMinutes = 10): string {
  const [datePart, timePart] = value.split("T");
  if (!datePart || !timePart) return value;
  const [year, month, day] = datePart.split("-").map(Number);
  const [hh, mm] = timePart.split(":").map(Number);
  if ([year, month, day, hh, mm].some((n) => Number.isNaN(n))) return value;
  const d = new Date(year, month - 1, day, hh, mm);
  const rounded = Math.round((d.getHours() * 60 + d.getMinutes()) / stepMinutes) * stepMinutes;
  d.setHours(0, rounded, 0, 0); // setHours normaliserer selv overløb til næste dag/måned lokalt
  return `${localISODate(d)}T${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/**
 * Lægger `deltaMinutes` til et rå klokkeslæt ("HH:mm"), med rundkørsel i
 * døgnet. Bruges til at gøre museknap-rul over <input type="time"> hop i
 * 10-minutters-spring i stedet for browserens indbyggede 1-minuts-spring
 * (Chrome/Edge respekterer ikke `step` ved rul, kun ved klik på op/ned-pilene
 * - feedback fra centeret var at det stadig "hoppede med 1 minut når man
 * ruller", så vi overtager selv rul-håndteringen).
 */
export function stepTimeString(time: string, deltaMinutes: number): string {
  const [hh, mm] = time.split(":").map(Number);
  if (Number.isNaN(hh) || Number.isNaN(mm)) return time;
  const total = (((hh * 60 + mm + deltaMinutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/** Samme som `stepTimeString`, men for en rå datetime-local-værdi ("YYYY-MM-DDTHH:mm"); overløb ruller til næste/forrige dag. */
export function stepDateTimeLocalString(value: string, deltaMinutes: number): string {
  const [datePart, timePart] = value.split("T");
  if (!datePart || !timePart) return value;
  const [year, month, day] = datePart.split("-").map(Number);
  const [hh, mm] = timePart.split(":").map(Number);
  if ([year, month, day, hh, mm].some((n) => Number.isNaN(n))) return value;
  const d = new Date(year, month - 1, day, hh, mm + deltaMinutes);
  return `${localISODate(d)}T${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
