/**
 * Heuristisk dansk mailfortolker til bookingforespørgsler.
 *
 * Dette er MVP-implementeringen af "AI-mailassistenten" beskrevet i kravene.
 * Den er bevidst bygget som en selvstændig, udskiftelig funktion: samme
 * input/output-kontrakt (parseBookingMail) kan senere implementeres af et
 * kald til en rigtig sprogmodel (fx Claude) uden at resten af systemet
 * (indbakke, konfliktcheck, godkendelsesflow) skal ændres.
 *
 * Se README/ARKITEKTUR.md for hvordan man kobler en rigtig LLM til i stedet.
 */

import type { Facility } from "@/lib/facilities";
import { localISODate } from "@/lib/date";

const WEEKDAYS = [
  "søndag",
  "mandag",
  "tirsdag",
  "onsdag",
  "torsdag",
  "fredag",
  "lørdag",
];

const MONTHS: Record<string, number> = {
  januar: 0,
  februar: 1,
  marts: 2,
  april: 3,
  maj: 4,
  juni: 5,
  juli: 6,
  august: 7,
  september: 8,
  oktober: 9,
  november: 10,
  december: 11,
};

export interface ParsedLine {
  raw: string;
  weekdayText?: string;
  weekday?: number;
  startTime: string;
  endTime: string;
  singleDate?: string; // ISO dato (YYYY-MM-DD)
  periodStart?: string;
  periodEnd?: string;
  facilityText?: string;
  facilityId?: string;
  comment?: string;
}

export interface ParsedMail {
  organizationName?: string;
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
  type: "saeson" | "enkelt";
  lines: ParsedLine[];
  summary: string;
}

function findEmail(text: string): string | undefined {
  const m = text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
  return m?.[0];
}

function findPhone(text: string): string | undefined {
  const m = text.match(/(\+45\s?)?\b\d{2}\s?\d{2}\s?\d{2}\s?\d{2}\b/);
  return m?.[0]?.trim();
}

function findFacility(text: string, facilities: Facility[]): { text?: string; id?: string } {
  const lower = text.toLowerCase();
  // Match længste facilitetsnavn først, så "Hal 1" ikke matcher før "Hal 1A"
  const sorted = [...facilities].sort((a, b) => b.name.length - a.name.length);
  for (const f of sorted) {
    if (lower.includes(f.name.toLowerCase())) {
      return { text: f.name, id: f.id };
    }
  }
  // Generisk fallback: "hal", "sal", "bane" efterfulgt af tal
  const m = text.match(/\b(hal|sal|bane|lokale)\s?\d+[a-zA-Z]?\b/i);
  return { text: m?.[0] };
}

function findWeekday(text: string): { text?: string; index?: number } {
  const lower = text.toLowerCase();
  for (let i = 0; i < WEEKDAYS.length; i++) {
    if (lower.includes(WEEKDAYS[i])) {
      return { text: WEEKDAYS[i], index: i };
    }
  }
  return {};
}

function findTimeRange(text: string): { start?: string; end?: string } {
  // "16.00-18.00", "16:00-18:00", "18-20", "kl. 18-20", "fra kl. 18.00 til 20.00"
  let m = text.match(/(\d{1,2})[.:](\d{2})\s*-\s*(\d{1,2})[.:](\d{2})/);
  if (m) {
    return {
      start: `${m[1].padStart(2, "0")}:${m[2]}`,
      end: `${m[3].padStart(2, "0")}:${m[4]}`,
    };
  }
  m = text.match(/kl\.?\s*(\d{1,2})\s*-\s*(\d{1,2})/i);
  if (m) {
    return {
      start: `${m[1].padStart(2, "0")}:00`,
      end: `${m[2].padStart(2, "0")}:00`,
    };
  }
  m = text.match(/\bfra\s+(\d{1,2})\s*(?:til|-)\s*(\d{1,2})\b/i);
  if (m) {
    return {
      start: `${m[1].padStart(2, "0")}:00`,
      end: `${m[2].padStart(2, "0")}:00`,
    };
  }
  return {};
}

function findPeriod(text: string): { start?: string; end?: string } {
  // "01/09-30/04" eller "01/09/2026-30/04/2027"
  const m = text.match(/(\d{2})\/(\d{2})(?:\/(\d{4}))?\s*-\s*(\d{2})\/(\d{2})(?:\/(\d{4}))?/);
  if (!m) return {};
  const now = new Date();
  const startYear = m[3] ? Number(m[3]) : now.getFullYear();
  let endYear = m[6] ? Number(m[6]) : startYear;
  // Sæson der løber over årsskifte (fx 01/09-30/04): hvis slutmåneden er
  // tidligere end startmåneden, ligger slutdatoen i det følgende kalenderår.
  if (!m[6] && Number(m[5]) < Number(m[2])) endYear = startYear + 1;
  const start = `${startYear}-${m[2]}-${m[1]}`;
  const end = `${endYear}-${m[5]}-${m[4]}`;
  return { start, end };
}

function findSingleDate(text: string): string | undefined {
  // "17. oktober" eller "17/10" eller "17-10"
  const m1 = text.match(/(\d{1,2})\.\s*(januar|februar|marts|april|maj|juni|juli|august|september|oktober|november|december)/i);
  if (m1) {
    const day = Number(m1[1]);
    const month = MONTHS[m1[2].toLowerCase()];
    const now = new Date();
    let year = now.getFullYear();
    // Hvis datoen allerede er passeret i år, antag næste år
    const candidate = new Date(year, month, day);
    if (candidate.getTime() < now.getTime() - 24 * 3600 * 1000) year += 1;
    return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
  // Kun "/" som separator for enkeltdatoer ("17/10") - "-" er reserveret til
  // tidsrum ("14-16") og perioder ("01/09-30/04") og ville ellers give falske
  // positiver, fx et klokkeslæt-interval der fejlagtigt tolkes som en dato.
  const m2 = text.match(/\b(\d{1,2})\/(\d{1,2})\b/);
  if (m2) {
    const day = Number(m2[1]);
    const month = Number(m2[2]) - 1;
    if (day < 1 || day > 31 || month < 0 || month > 11) return undefined;
    const now = new Date();
    let year = now.getFullYear();
    const candidate = new Date(year, month, day);
    if (candidate.getTime() < now.getTime() - 24 * 3600 * 1000) year += 1;
    return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
  return undefined;
}

function findOrganizationName(text: string): string | undefined {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    const m = line.match(/^([A-ZÆØÅ][\wÆØÅæøå.'&-]*(?:\s+[A-ZÆØÅ0-9][\wÆØÅæøå.'&-]*){0,3})\s+(ønsker|søger|vil gerne|forespørger)/i);
    if (m) return m[1].trim();
  }
  const fromMatch = text.match(/^Fra:\s*(.+)$/im);
  if (fromMatch) return fromMatch[1].trim();
  return undefined;
}

function findContactName(text: string): string | undefined {
  const sigMatch = text.match(/(?:Mvh|Med venlig hilsen|Venlig hilsen|Hilsen)[,.]?\s*\n?\s*([A-ZÆØÅ][\wÆØÅæøå'-]+\s+[A-ZÆØÅ][\wÆØÅæøå'-]+)/i);
  if (sigMatch) return sigMatch[1].trim();
  return undefined;
}

function nextOccurrenceOfWeekday(weekday: number, from: Date = new Date()): string {
  const d = new Date(from);
  d.setHours(0, 0, 0, 0);
  const diff = (weekday - d.getDay() + 7) % 7;
  d.setDate(d.getDate() + diff);
  return localISODate(d);
}

export function parseBookingMail(rawText: string, facilities: Facility[]): ParsedMail {
  const lines = rawText.split("\n").map((l) => l.trim()).filter(Boolean);
  const organizationName = findOrganizationName(rawText);
  const contactName = findContactName(rawText);
  const contactEmail = findEmail(rawText);
  const contactPhone = findPhone(rawText);
  const period = findPeriod(rawText);

  const parsedLines: ParsedLine[] = [];

  for (const line of lines) {
    const weekday = findWeekday(line);
    const time = findTimeRange(line);
    const facility = findFacility(line, facilities);
    const singleDate = findSingleDate(line);

    // Kun en gyldig linje hvis vi kan finde et tidsrum
    if (!time.start || !time.end) continue;

    // Hvis der ikke er en eksplicit dato eller periode, men en ugedag er nævnt
    // ("fredag", "lørdag"), antager vi nærmeste kommende forekomst af den dag.
    // Dette skal altid vises tydeligt til medarbejderen som et forslag - se
    // linjens "raw"-felt, som altid viser den oprindelige mailtekst.
    let resolvedSingleDate = period.start ? undefined : singleDate;
    if (!resolvedSingleDate && !period.start && weekday.index !== undefined) {
      resolvedSingleDate = nextOccurrenceOfWeekday(weekday.index);
    }

    parsedLines.push({
      raw: line,
      weekdayText: weekday.text,
      weekday: weekday.index,
      startTime: time.start,
      endTime: time.end,
      singleDate: resolvedSingleDate,
      periodStart: period.start,
      periodEnd: period.end,
      facilityText: facility.text,
      facilityId: facility.id,
    });
  }

  const type: "saeson" | "enkelt" = period.start || parsedLines.length > 1 ? "saeson" : "enkelt";

  const summary =
    parsedLines.length === 0
      ? "Kunne ikke finde nogen tydelige bookingønsker i mailen. Kræver manuel gennemgang."
      : `Fandt ${parsedLines.length} bookingønske(r)${organizationName ? ` fra ${organizationName}` : ""}${
          period.start ? ` for perioden ${period.start} til ${period.end}` : ""
        }.`;

  return {
    organizationName,
    contactName,
    contactEmail,
    contactPhone,
    type,
    lines: parsedLines,
    summary,
  };
}
