"use client";

import { bookingLastDay, bookingOnDay, dayTimeLabel, isMultiDay } from "@/lib/multiday";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { BookingDTO, DayNoteDTO, FacilityDTO, OrganizationDTO } from "@/lib/clientTypes";
import {
  BOOKING_STATUS_CLASSES,
  BOOKING_STATUS_LABELS,
  SEASON_BADGE_CLASSES,
  SEASON_BADGE_LABEL,
  IMPORTANT_BADGE_CLASSES,
  IMPORTANT_BADGE_LABEL,
  weekdayName,
} from "@/lib/statusLabels";
import { capitalizeDaDate, formatDaDate, formatDaTime } from "@/lib/ai/messages";
import { isoWeekNumber, localISODate, nowLocalDateTimeString, roundDateTimeLocalString } from "@/lib/date";
import { BookingFormModal } from "./BookingFormModal";
import { DEFAULT_LIGHT_LEVEL, LIGHT_LEVELS, facilityHasLightControl } from "@/lib/lightLevels";
import { DayNoteModal } from "./DayNoteModal";

type ViewMode = "ugeplan" | "dag";

function startOfWeek(d: Date): Date {
  const date = new Date(d);
  const day = (date.getDay() + 6) % 7; // mandag = 0
  date.setDate(date.getDate() - day);
  date.setHours(0, 0, 0, 0);
  return date;
}

function addDays(d: Date, n: number): Date {
  const date = new Date(d);
  date.setDate(date.getDate() + n);
  return date;
}

/**
 * Parser en "naiv" lokal dato-tid-streng ("YYYY-MM-DDTHH:mm:ss", uden
 * tidszone) til et lokalt Date-objekt - samme konvention som src/lib/date.ts
 * (ALDRIG via `new Date(isoString)` med implicit UTC-fortolkning). Bruges af
 * dagsplanens træk/slip-logik (DayGridView) til at regne i minutter-på-dagen.
 */
function parseNaiveDateTime(value: string): Date {
  const [datePart, timePart] = value.split("T");
  const [year, month, day] = datePart.split("-").map(Number);
  const [hh, mm, ss] = (timePart ?? "00:00:00").split(":").map(Number);
  return new Date(year, month - 1, day, hh, mm || 0, ss || 0);
}

/** Modstykket til `parseNaiveDateTime` - formaterer et lokalt Date-objekt tilbage til samme naive streng-konvention. */
function toNaiveDateTimeString(d: Date): string {
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${localISODate(d)}T${hh}:${mm}:${ss}`;
}

function minutesOfDay(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}

/**
 * Den del af bookingen der ligger på `dayStr`, i minutter siden midnat.
 * Første dag starter ved bookingens starttid, sidste dag slutter ved
 * sluttiden, og dage midt imellem fylder hele dagen (fra `gridStartMin`).
 */
function daySegment(
  b: BookingDTO,
  dayStr: string,
  gridStartMin: number = DAY_GRID_START_MIN
): { startMin: number; endMin: number } {
  const startMin = dayStr === b.startsAt.slice(0, 10) ? minutesOfDay(parseNaiveDateTime(b.startsAt)) : gridStartMin;
  const endMin =
    dayStr === bookingLastDay(b) && b.endsAt.slice(0, 10) === dayStr
      ? minutesOfDay(parseNaiveDateTime(b.endsAt))
      : 24 * 60;
  return { startMin, endMin };
}

/** Bygger en naiv dato-tid-streng for `dateStr` ("YYYY-MM-DD") + `minutes` minutter siden midnat. */
function minutesToNaiveDateTimeString(dateStr: string, minutes: number): string {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setMinutes(d.getMinutes() + minutes);
  return toNaiveDateTimeString(d);
}

function clampMinutes(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Konverterer en facilitets hex-farve (fx "#2563eb") til en rgba()-streng med
 * den ønskede transparens. Bruges af `facilityCardStyle` til at give hver
 * booking en tydelig farvet baggrundstone efter hvilken facilitet den hører
 * til, i stedet for kun den tidligere tynde 3px venstre-kant-streg. Martin
 * har efterspurgt en langt mere synlig farve-markering af fx Opvisningshallen
 * vs. Træningshallen i kalenderoversigten, da de to haller ofte kolliderer
 * (kampe vs. træning).
 */
function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace("#", "");
  const full = clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean;
  const int = parseInt(full, 16) || 0;
  const r = (int >> 16) & 255;
  const g = (int >> 8) & 255;
  const b = int & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Style til et booking-kort/-chip: en tyk farvet venstre-kant plus en let
 * farvet baggrundstone i facilitetens farve - så man på afstand kan se
 * hvilken facilitet en booking hører til, uden at overdøve status-farverne
 * (afventer/bekræftet/betalt m.v. fra BOOKING_STATUS_CLASSES), som stadig
 * styrer tekstfarve og den tynde ramme. Aflyste/afviste bookinger beholder i
 * stedet deres røde status-baggrund uændret, så en aflysning altid er
 * tydelig at få øje på, uanset facilitet.
 */
function facilityCardStyle(color: string | null | undefined, status: string): CSSProperties {
  if (!color) return {};
  const style: CSSProperties = { borderLeftColor: color, borderLeftWidth: 6 };
  if (status !== "aflyst" && status !== "afvist") {
    style.backgroundColor = hexToRgba(color, 0.16);
  }
  return style;
}

/** Mørkner (factor < 1) en hex-farve - bruges til fyldte enkeltbooking-kort, så hvid tekst altid kan læses. */
function shadeHex(hex: string, factor: number): string {
  const clean = hex.replace("#", "");
  const full = clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean;
  const int = parseInt(full, 16) || 0;
  const ch = (v: number) => Math.max(0, Math.min(255, Math.round(v * factor)));
  const r = ch((int >> 16) & 255);
  const g = ch((int >> 8) & 255);
  const b = ch(int & 255);
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/** Statusser hvor bookingen endnu ikke er endeligt på plads - vises med stiplet kant og "Afventer"-mærke. */
const WAITING_STATUSES = new Set(["forespoergsel", "afventer_godkendelse", "midlertidig", "reserveret"]);

/**
 * Fælles udseende for bookinger i Dagsplan og Ugeplan, så forskellen på
 * booking-typerne er tydelig på afstand:
 * - ENKELTBOOKING: fyldt, mættet facilitetsfarve med hvid tekst.
 * - SÆSONBOOKING (gentages ugentligt): lys farvetone, tyk farvet kant og farvet
 *   tekst - tydeligt "lettere" end en enkeltbooking, plus et ↻-mærke.
 * - VIGTIG/KAMP: kraftig rød ring + flag.
 * - AFVENTER: stiplet kant.
 * Aflyste/afviste bookinger beholder de røde statusfarver.
 */
function bookingVisual(color: string, b: BookingDTO): { style: CSSProperties; className: string } {
  if (b.status === "aflyst" || b.status === "afvist") {
    return { style: facilityCardStyle(color, b.status), className: `border ${BOOKING_STATUS_CLASSES[b.status] ?? ""}` };
  }
  const isSeason = !!b.seasonGroupId;
  const style: CSSProperties = isSeason
    ? {
        backgroundColor: hexToRgba(color, 0.13),
        borderColor: hexToRgba(color, 0.45),
        borderLeftColor: color,
        borderLeftWidth: 6,
        color: shadeHex(color, 0.55),
      }
    : {
        backgroundColor: shadeHex(color, 0.72),
        borderColor: shadeHex(color, 0.6),
        borderLeftColor: color,
        borderLeftWidth: 6,
        color: "#ffffff",
      };
  if (WAITING_STATUSES.has(b.status)) style.borderStyle = "dashed";
  return { style, className: `border ${b.important ? "ring-2 ring-inset ring-red-600" : ""}` };
}

/** Faneblade (HALLER, MØDELOKALER, ...) - hvert fanebladet samler de faciliteter, der hører sammen. */
interface FacilityTabDef {
  key: string;
  label: string;
  color: string;
  /** Matcher på facilitetens navn (med små bogstaver). */
  match: (name: string) => boolean;
  /** Rækkefølge af faciliteterne i fanebladet (navnepræfikser med små bogstaver). */
  order: string[];
  /** Faciliteter der vises side om side i samme række i ugeplanen (navne med små bogstaver). */
  sideBySide?: string[][];
}

const FACILITY_TAB_DEFS: FacilityTabDef[] = [
  {
    key: "haller",
    label: "Haller",
    color: "#2563eb",
    match: (n) => n === "opvisningshallen" || n === "træningshallen" || n === "multisalen",
    order: ["opvisningshallen", "træningshallen", "multisalen"],
    // De to 20x40 m haller kan ofte erstatte hinanden, så de vises side om side i samme række.
    sideBySide: [["opvisningshallen", "træningshallen"]],
  },
  {
    key: "moedelokaler",
    label: "Mødelokaler",
    color: "#0d9488",
    match: (n) => n.startsWith("mødelokale") || n === "klubsekretariatet",
    order: ["mødelokale 1", "mødelokale 2", "mødelokale 3", "mødelokale 4", "klubsekretariatet"],
  },
  {
    key: "klatrevaeg",
    label: "Klatrevæg",
    color: "#9333ea",
    match: (n) => n.startsWith("klatrevæg") || n === "opvisningshallen",
    order: ["klatrevæg", "opvisningshallen"],
  },
  {
    key: "pickleball",
    label: "Pickleball",
    color: "#ea580c",
    match: (n) => n.includes("pickleball"),
    order: [],
  },
];

interface FacilityTab {
  key: string;
  label: string;
  color: string;
  facilities: FacilityDTO[];
  /** Faciliteterne grupperet i rækker (typisk én pr. række; enkelte grupper vises side om side). */
  groups: FacilityDTO[][];
}

/** Størrelser der vises under facilitetens navn i ugeplanen (Multisalen er for lille til boldspil). */
const FACILITY_SIZE_NOTES: Record<string, string> = {
  opvisningshallen: "20 × 40 m",
  træningshallen: "20 × 40 m",
  multisalen: "20 × 20 m",
};

function buildFacilityTabs(allFacilities: FacilityDTO[]): FacilityTab[] {
  const active = allFacilities.filter((f) => !f.archived);
  const used = new Set<string>();
  const tabs: FacilityTab[] = [];
  for (const def of FACILITY_TAB_DEFS) {
    const list = active.filter((f) => def.match(f.name.toLowerCase()));
    if (list.length === 0) continue;
    list.forEach((f) => used.add(f.id));
    const rank = (f: FacilityDTO) => {
      const idx = def.order.findIndex((o) => f.name.toLowerCase().startsWith(o));
      return idx === -1 ? 99 : idx;
    };
    list.sort(
      (a, b) =>
        rank(a) - rank(b) ||
        (a.sortOrder ?? 0) - (b.sortOrder ?? 0) ||
        a.name.localeCompare(b.name, "da", { numeric: true })
    );
    const groups: FacilityDTO[][] = [];
    const placed = new Set<string>();
    for (const f of list) {
      if (placed.has(f.id)) continue;
      const pair = def.sideBySide?.find((names) => names.includes(f.name.toLowerCase()));
      const members = pair ? list.filter((x) => pair.includes(x.name.toLowerCase())) : [f];
      members.sort((a, b) => pair!.indexOf(a.name.toLowerCase()) - pair!.indexOf(b.name.toLowerCase()));
      if (!pair || members.length < 2) {
        placed.add(f.id);
        groups.push([f]);
      } else {
        members.forEach((m) => placed.add(m.id));
        groups.push(members);
      }
    }
    tabs.push({ key: def.key, label: def.label, color: def.color, facilities: list, groups });
  }
  // Faciliteter der ikke passer i et fanebladet (fx nyoprettede) samles i "Andet", så intet forsvinder fra kalenderen.
  const rest = active.filter((f) => !used.has(f.id));
  if (rest.length > 0) tabs.push({ key: "andet", label: "Andet", color: "#475569", facilities: rest, groups: rest.map((f) => [f]) });
  return tabs;
}

/** Farver til at skelne faciliteter, der i databasen har samme farve (fx alle pickleballbanerne eller mødelokalerne). */
const DISTINCT_COLORS = ["#2563eb", "#16a34a", "#d97706", "#db2777", "#7c3aed", "#0891b2", "#dc2626", "#65a30d"];

function buildColorMap(tabs: FacilityTab[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const tab of tabs) {
    const counts = new Map<string, number>();
    for (const f of tab.facilities) {
      const c = (f.color ?? "#64748b").toLowerCase();
      counts.set(c, (counts.get(c) ?? 0) + 1);
    }
    const taken = new Set(Array.from(counts.entries()).filter(([, n]) => n === 1).map(([c]) => c));
    let next = 0;
    for (const f of tab.facilities) {
      if (map.has(f.id)) continue;
      const c = (f.color ?? "#64748b").toLowerCase();
      if ((counts.get(c) ?? 0) === 1) {
        map.set(f.id, f.color ?? "#64748b");
      } else {
        while (next < DISTINCT_COLORS.length && taken.has(DISTINCT_COLORS[next])) next++;
        const pick = DISTINCT_COLORS[next % DISTINCT_COLORS.length];
        next++;
        taken.add(pick);
        map.set(f.id, pick);
      }
    }
  }
  return map;
}

/** Kort visningsnavn til en facilitet i rækkeoverskrifter (fx "Pickleballbane/Badmintonbane 3" -> "Bane 3"). */
function shortFacilityName(name: string): { main: string; sub?: string } {
  const m = name.match(/^Pickleballbane\/Badmintonbane (\d+)$/i);
  if (m) return { main: `Bane ${m[1]}`, sub: "Pickleball / badminton" };
  return { main: name };
}

const PAYMENT_STATUS_LABELS: Record<string, string> = {
  ikke_paakraevet: "",
  afventer: "afventer betaling",
  betalt: "betalt",
  annulleret: "annulleret",
  refunderet: "refunderet",
};

/**
 * Bygger teksten til mouse-over-tooltippen på et booking-kort - ekstra
 * oplysninger man ellers skulle åbne bookingen for at se (kontaktperson,
 * dørkode, pris m.v.). Vises via den almindelige `title`-attribut, så det
 * virker uden yderligere UI-tilstand og er skærmlæser-venligt.
 */
function bookingTooltip(booking: BookingDTO, facilityNameStr: string, organizationNameStr?: string): string {
  const lines = [
    booking.title,
    facilityNameStr,
    `${formatDaDate(booking.startsAt)}, ${formatDaTime(booking.startsAt)}-${formatDaTime(booking.endsAt)}`,
    `Status: ${BOOKING_STATUS_LABELS[booking.status] ?? booking.status}`,
  ];
  if (booking.seasonGroupId) lines.push("↻ Sæsonbooking (gentages ugentligt)");
  if (booking.important) lines.push("⚑ VIGTIG/KAMP");
  if (booking.lightLevel && booking.lightLevel !== 400) lines.push(`💡 Lys: ${booking.lightLevel} lux`);
  if (organizationNameStr) lines.push(`Forening: ${organizationNameStr}`);
  if (booking.contactName) lines.push(`Kontakt: ${booking.contactName}`);
  if (booking.contactEmail) lines.push(`E-mail: ${booking.contactEmail}`);
  if (booking.contactPhone) lines.push(`Telefon: ${booking.contactPhone}`);
  if (booking.accessCode) lines.push(`Dørkode: ${booking.accessCode}`);
  if (booking.price) {
    const label = booking.paymentStatus ? PAYMENT_STATUS_LABELS[booking.paymentStatus] ?? "" : "";
    lines.push(`Pris: ${booking.price} kr.${label ? ` (${label})` : ""}`);
  }
  if (booking.notes) lines.push(`Note: ${booking.notes}`);
  return lines.join("\n");
}

export function CalendarClient({
  initialFacilities,
  initialOrganizations,
}: {
  initialFacilities: FacilityDTO[];
  initialOrganizations: OrganizationDTO[];
}) {
  const [facilities] = useState(initialFacilities);
  const [organizations] = useState(initialOrganizations);
  const [bookings, setBookings] = useState<BookingDTO[]>([]);
  const [dayNotes, setDayNotes] = useState<DayNoteDTO[]>([]);
  const [view, setView] = useState<ViewMode>("ugeplan");
  // "Stille flytning": når slået til, kommer flytninger (træk/slip og "flyt til i morgen/i går") hverken på aflysningslisten eller som mail.
  const [silentMove, setSilentMove] = useState(false);
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (window.localStorage.getItem("kalender-stille-flyt") === "1") setSilentMove(true);
    } catch {
      // localStorage kan mangle - så er den bare slået fra.
    }
  }, []);
  function toggleSilentMove() {
    setSilentMove((v) => {
      try {
        window.localStorage.setItem("kalender-stille-flyt", v ? "0" : "1");
      } catch {
        // ignorer
      }
      return !v;
    });
  }
  const [anchor, setAnchor] = useState(new Date());
  // Faneblade (HALLER, MØDELOKALER, KLATREVÆG, PICKLEBALL) erstatter det tidligere "Vis faciliteter"-filter.
  const tabs = useMemo(() => buildFacilityTabs(initialFacilities), [initialFacilities]);
  const colorMap = useMemo(() => buildColorMap(tabs), [tabs]);
  const [tabKey, setTabKey] = useState<string>("haller");
  useEffect(() => {
    // Husk sidst valgte faneblad (læses først efter første render, så server- og klient-HTML er ens).
    try {
      const saved = window.localStorage.getItem("kalender-tab");
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (saved && tabs.some((t) => t.key === saved)) setTabKey(saved);
    } catch {
      // localStorage kan være utilgængelig - så starter vi bare på standardfanebladet.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const activeTab = tabs.find((t) => t.key === tabKey) ?? tabs[0];
  const tabFacilities = useMemo(
    () => (activeTab?.facilities ?? []).map((f) => ({ ...f, color: colorMap.get(f.id) ?? f.color })),
    [activeTab, colorMap]
  );
  const tabGroups = useMemo(
    () =>
      (activeTab?.groups ?? []).map((g) => g.map((f) => ({ ...f, color: colorMap.get(f.id) ?? f.color }))),
    [activeTab, colorMap]
  );
  function chooseTab(key: string) {
    setTabKey(key);
    try {
      window.localStorage.setItem("kalender-tab", key);
    } catch {
      // ignoreres
    }
  }
  const [showModal, setShowModal] = useState(false);
  // Forudfyldes når man dobbeltklikker en dag i kalenderen (og ev. en
  // facilitet, i facilitetsvisningen) - se `openNewBookingFor` herunder.
  const [modalDefaultStart, setModalDefaultStart] = useState<string | undefined>(undefined);
  const [modalDefaultFacilityId, setModalDefaultFacilityId] = useState<string | undefined>(undefined);
  const [selectedBooking, setSelectedBooking] = useState<BookingDTO | null>(null);
  // Booking der redigeres direkte via højreklik-hurtigmenuen (se
  // BookingContextMenu) - adskilt fra `selectedBooking`/`showModal`, så
  // "Rediger" i hurtigmenuen springer direkte til redigeringsformularen uden
  // først at åbne detalje-boksen.
  const [quickEditBooking, setQuickEditBooking] = useState<BookingDTO | null>(null);
  // Højreklik-hurtigmenuen: position + hvilken booking den blev åbnet for.
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; booking: BookingDTO } | null>(null);
  // Dagsnote der redigeres/oprettes (fx "tekniker kommer til ventilationen") -
  // se DayNoteModal. `date` er sat når man opretter en NY note for en dag,
  // `note` er sat i stedet når man redigerer en eksisterende.
  const [noteModal, setNoteModal] = useState<{ date: string; note?: DayNoteDTO } | null>(null);
  const [loading, setLoading] = useState(false);
  // Dagsplanens træk/slip-tilstand (se DayGridView) - løftet herop, så
  // pil-knapperne i værktøjslinjen kan fremhæves som gyldige "slip her for at
  // flytte til forrige/næste dag"-mål, mens man trækker.
  const [dayDragActive, setDayDragActive] = useState(false);
  const [dragConflict, setDragConflict] = useState<{
    booking: BookingDTO;
    conflicts: BookingDTO[];
    pending: { facilityId: string; startsAt: string; endsAt: string };
  } | null>(null);
  const [dragBusy, setDragBusy] = useState(false);
  // Når man flytter (træk/slip eller "flyt til i morgen/i går") en booking
  // der er del af en sæson, og der reelt ændres tid/facilitet, spørges der
  // først om kun denne ene forekomst eller hele resten af sæsonen skal
  // flyttes (Martin) - se applyBookingChange.
  const [seasonMoveChoice, setSeasonMoveChoice] = useState<{
    booking: BookingDTO;
    pending: { facilityId: string; startsAt: string; endsAt: string };
  } | null>(null);
  const [seasonDragConflict, setSeasonDragConflict] = useState<{
    booking: BookingDTO;
    pending: { facilityId: string; startsAt: string; endsAt: string };
    conflictsByDate: Record<string, BookingDTO[]>;
  } | null>(null);
  const [seasonMoveBusy, setSeasonMoveBusy] = useState(false);

  const rangeStart = useMemo(() => {
    if (view === "dag") {
      const d = new Date(anchor);
      d.setHours(0, 0, 0, 0);
      return d;
    }
    return startOfWeek(anchor);
  }, [view, anchor]);

  const rangeEnd = useMemo(() => {
    if (view === "dag") {
      const d = new Date(anchor);
      d.setHours(0, 0, 0, 0);
      return addDays(d, 1);
    }
    return addDays(startOfWeek(anchor), 7);
  }, [view, anchor]);

  // Samlet dato/uge-label til den fastfrosne værktøjslinje foroven - så man
  // altid kan se hvilken periode man kigger på, uanset hvor langt man har
  // scrollet ned i en lang visning (fx Dagsplan eller Ugeplan). Erstatter de
  // tidligere selvstændige overskrifter inde i selve Dagsplan-/Ugeplan-
  // visningerne, som forsvandt ud af syne ved scroll.
  const headerDateLabel = useMemo(() => {
    const monthNameDa = (d: Date) => d.toLocaleDateString("da-DK", { month: "long" });
    if (view === "dag") {
      return `${capitalizeDaDate(formatDaDate(rangeStart.toISOString()))} \u00b7 Uge ${isoWeekNumber(rangeStart)}`;
    }
    {
      const weekEnd = addDays(rangeStart, 6);
      const range =
        rangeStart.getMonth() === weekEnd.getMonth()
          ? `${rangeStart.getDate()}.\u2013${weekEnd.getDate()}. ${monthNameDa(weekEnd)} ${weekEnd.getFullYear()}`
          : `${rangeStart.getDate()}. ${monthNameDa(rangeStart)} \u2013 ${weekEnd.getDate()}. ${monthNameDa(weekEnd)} ${weekEnd.getFullYear()}`;
      return `Uge ${isoWeekNumber(rangeStart)} \u00b7 ${range}`;
    }
  }, [view, rangeStart]);

  async function loadBookings() {
    setLoading(true);
    const params = new URLSearchParams({
      from: nowLocalDateTimeString(rangeStart),
      to: nowLocalDateTimeString(rangeEnd),
    });
    const res = await fetch(`/api/bookings?${params}`);
    const data = await res.json();
    setBookings(data);
    setLoading(false);
  }

  async function loadDayNotes() {
    const params = new URLSearchParams({
      from: localISODate(rangeStart),
      to: localISODate(addDays(rangeEnd, -1)),
    });
    const res = await fetch(`/api/day-notes?${params}`);
    setDayNotes(await res.json());
  }

  useEffect(() => {
    loadBookings();
    loadDayNotes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, anchor]);

  const tabFacilityIds = useMemo(() => new Set(tabFacilities.map((f) => f.id)), [tabFacilities]);
  const visibleBookings = bookings
    .filter((b) => tabFacilityIds.has(b.facilityId))
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));

  function notesForDay(dateStr: string): DayNoteDTO[] {
    return dayNotes.filter((n) => n.date === dateStr);
  }

  /**
   * Åbner "Ny booking"-formularen forudfyldt med `dateStr` (og ev. en
   * facilitet) - brugt når man dobbeltklikker en dag i kalenderen. Det
   * dækker det almindelige arbejdsmønster centeret beskrev: nogen ringer og
   * ønsker en bestemt dag, man blader kalenderen frem til dagen og
   * dobbeltklikker i stedet for at skulle taste datoen ind manuelt.
   * Klokkeslættet forudfyldes med det nuværende tidspunkt (rundet til
   * nærmeste 5 minutter) - blot som et fornuftigt udgangspunkt, det
   * justeres frit i formularen bagefter.
   */
  function openNewBookingFor(dateStr: string, facilityId?: string, timeHHMM?: string) {
    let hh: string;
    let mm: string;
    if (timeHHMM) {
      [hh, mm] = timeHHMM.split(":");
    } else {
      const now = new Date();
      hh = String(now.getHours()).padStart(2, "0");
      mm = String(now.getMinutes()).padStart(2, "0");
    }
    const rounded = roundDateTimeLocalString(`${dateStr}T${hh}:${mm}`);
    setModalDefaultStart(`${rounded}:00`);
    setModalDefaultFacilityId(facilityId);
    setSelectedBooking(null);
    setShowModal(true);
  }

  function facilityName(id: string) {
    return facilities.find((f) => f.id === id)?.name ?? "Ukendt";
  }

  function organizationName(id: string | null) {
    if (!id) return undefined;
    return organizations.find((o) => o.id === id)?.name;
  }

  /** Åbner højreklik-hurtigmenuen for en booking på musens position. */
  function openContextMenu(e: ReactMouseEvent, booking: BookingDTO) {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, booking });
  }

  /** Sætter lysniveauet (lux) på én booking - eller på denne og alle senere forekomster af en sæson. */
  async function quickSetLight(booking: BookingDTO, level: number, wholeSeason: boolean) {
    setContextMenu(null);
    if (wholeSeason && booking.seasonGroupId) {
      await fetch(`/api/bookings/season/${booking.seasonGroupId}/light`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ anchorBookingId: booking.id, lightLevel: level }),
      });
    } else {
      await fetch(`/api/bookings/${booking.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lightLevel: level }),
      });
    }
    loadBookings();
  }

  /** "Slet stille": bookingen fjernes, men kommer ikke på aflysningslisten på hjemmesiden, og der sendes ingen mail. */
  async function quickSilentDelete(booking: BookingDTO) {
    const label = booking.seasonGroupId ? "denne dags forekomst af" : "";
    if (
      !window.confirm(
        `Slet ${label} "${booking.title}" STILLE?\n\nDen kommer IKKE på aflysningslisten på hjemmesiden, og der sendes ingen mail.`.replace("  ", " ")
      )
    )
      return;
    setContextMenu(null);
    await fetch(`/api/bookings/${booking.id}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ silent: true }),
    });
    loadBookings();
  }

  async function quickSilentDeleteSeason(booking: BookingDTO) {
    if (!booking.seasonGroupId) return;
    if (
      !window.confirm(
        `Slet HELE sæsonen "${booking.title}" (alle kommende forekomster) STILLE?\n\nDen kommer IKKE på aflysningslisten på hjemmesiden, og der sendes ingen mail.`
      )
    )
      return;
    setContextMenu(null);
    await fetch(`/api/bookings/season/${booking.seasonGroupId}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ silent: true }),
    });
    loadBookings();
  }

  async function quickCancelBooking(booking: BookingDTO) {
    const label = booking.seasonGroupId ? "denne dags forekomst af" : "";
    if (!window.confirm(`Aflys ${label} "${booking.title}"?`.replace("  ", " "))) return;
    const reason = window.prompt("Årsag (vises på aflysningslisten på hjemmesiden - kan stå tom):", "");
    if (reason === null) return;
    setContextMenu(null);
    await fetch(`/api/bookings/${booking.id}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason }),
    });
    loadBookings();
  }

  async function quickCancelSeason(booking: BookingDTO) {
    if (!booking.seasonGroupId) return;
    if (!window.confirm(`Aflys HELE sæsonen "${booking.title}" (alle kommende forekomster)?`)) return;
    const reason = window.prompt("Årsag (vises på aflysningslisten på hjemmesiden - kan stå tom):", "");
    if (reason === null) return;
    setContextMenu(null);
    await fetch(`/api/bookings/season/${booking.seasonGroupId}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason }),
    });
    loadBookings();
  }

  function quickMailOrganizer(booking: BookingDTO) {
    setContextMenu(null);
    window.location.href = buildOrganizerMailtoLink(booking, facilityName(booking.facilityId));
  }

  async function quickCopyAccessCode(booking: BookingDTO) {
    if (!booking.accessCode) return;
    try {
      await navigator.clipboard.writeText(booking.accessCode);
    } catch {
      // Clipboard-API'et kan i sjældne tilfælde fejle (fx manglende
      // browser-tilladelse) - dørkoden kan stadig ses ved almindeligt klik på
      // bookingen, så vi fejler stille her.
    }
  }

  function quickEdit(booking: BookingDTO) {
    setContextMenu(null);
    setQuickEditBooking(booking);
  }

  /**
   * Sætter/fjerner "VIGTIG/KAMP"-markeringen på ÉN forekomst direkte fra
   * hurtigmenuen, uden at skulle åbne redigeringsformularen - PATCH'er kun
   * dette ene felt, så resten af bookingen (og en evt. sæson den er del af)
   * er urørt.
   */
  async function quickToggleImportant(booking: BookingDTO) {
    setContextMenu(null);
    await fetch(`/api/bookings/${booking.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ important: !booking.important }),
    });
    loadBookings();
  }

  /**
   * Flytter kun ÉN enkelt booking/forekomst: PATCH'er kun de(t) felt(er) der
   * ændres (facilitet og/eller tidspunkt) - PATCH-endpointet opdaterer kun de
   * medsendte felter og sender selv en flytningsmail (samme som ved
   * almindelig redigering). Ved konflikt (409) vises samme to-valgsboks som
   * alle andre steder i systemet (Martin), i stedet for enten at blokere
   * stille eller dobbeltbooke uden varsel.
   */
  async function applySingleBookingChange(
    booking: BookingDTO,
    pending: { facilityId: string; startsAt: string; endsAt: string },
    force: boolean
  ) {
    setDragBusy(true);
    const res = await fetch(`/api/bookings/${booking.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...pending, force, silent: silentMove }),
    });
    setDragBusy(false);
    if (res.status === 409) {
      const data = await res.json();
      setDragConflict({ booking, conflicts: data.conflicts, pending });
      return;
    }
    setDragConflict(null);
    loadBookings();
  }

  /**
   * Flytter HELE resten af en sæson via /api/bookings/season/[id]/move - se
   * den route for hvilke forekomster der reelt flyttes. Ved konflikt (409)
   * vises en sæson-udgave af to-valgsboksen ovenfor (grupperet pr. dato, da
   * flere forekomster kan konflikte samtidig).
   */
  async function applySeasonMoveChange(
    booking: BookingDTO,
    pending: { facilityId: string; startsAt: string; endsAt: string },
    force: boolean
  ) {
    if (!booking.seasonGroupId) return;
    setSeasonMoveBusy(true);
    const res = await fetch(`/api/bookings/season/${booking.seasonGroupId}/move`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ anchorBookingId: booking.id, ...pending, force, silent: silentMove }),
    });
    setSeasonMoveBusy(false);
    if (res.status === 409) {
      const data = await res.json();
      setSeasonDragConflict({ booking, pending, conflictsByDate: data.conflictsByDate });
      return;
    }
    setSeasonDragConflict(null);
    loadBookings();
  }

  /**
   * Indgangspunkt for ALLE flytninger (træk/slip i dagsplan/ugeplan, samt
   * "flyt til i morgen/i går" i hurtigmenuen). Hvis bookingen er del af en
   * sæson, og der reelt ændres tid og/eller facilitet, spørges der først om
   * hele resten af sæsonen eller kun denne ene forekomst skal flyttes
   * (Martin), i stedet for stiltiende kun at flytte den ene dag.
   */
  async function applyBookingChange(
    booking: BookingDTO,
    pending: { facilityId: string; startsAt: string; endsAt: string },
    force: boolean
  ) {
    const timeOrFacilityChanged =
      pending.facilityId !== booking.facilityId ||
      pending.startsAt !== booking.startsAt ||
      pending.endsAt !== booking.endsAt;
    if (booking.seasonGroupId && timeOrFacilityChanged && !force) {
      setSeasonMoveChoice({ booking, pending });
      return;
    }
    await applySingleBookingChange(booking, pending, force);
  }

  function chooseSingleBookingMove() {
    if (!seasonMoveChoice) return;
    const { booking, pending } = seasonMoveChoice;
    setSeasonMoveChoice(null);
    applySingleBookingChange(booking, pending, false);
  }

  function chooseSeasonMove() {
    if (!seasonMoveChoice) return;
    const { booking, pending } = seasonMoveChoice;
    setSeasonMoveChoice(null);
    applySeasonMoveChange(booking, pending, false);
  }

  async function resolveDragDoubleBook() {
    if (!dragConflict) return;
    await applySingleBookingChange(dragConflict.booking, dragConflict.pending, true);
  }

  async function resolveDragCancelOriginal() {
    if (!dragConflict) return;
    const { booking, conflicts, pending } = dragConflict;
    setDragBusy(true);
    for (const c of conflicts) {
      // eslint-disable-next-line no-await-in-loop
      await fetch(`/api/bookings/${c.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "aflyst" }),
      });
    }
    await applySingleBookingChange(booking, pending, true);
  }

  async function resolveSeasonDoubleBook() {
    if (!seasonDragConflict) return;
    await applySeasonMoveChange(seasonDragConflict.booking, seasonDragConflict.pending, true);
  }

  async function resolveSeasonCancelOriginal() {
    if (!seasonDragConflict) return;
    const { booking, pending, conflictsByDate } = seasonDragConflict;
    setSeasonMoveBusy(true);
    const allConflicts = Object.values(conflictsByDate).flat();
    for (const c of allConflicts) {
      // eslint-disable-next-line no-await-in-loop
      await fetch(`/api/bookings/${c.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "aflyst" }),
      });
    }
    await applySeasonMoveChange(booking, pending, true);
  }

  /** "Flyt til i morgen"/"Flyt til i går" i højreklik-hurtigmenuen - flytter både start og slut én dag, uændret klokkeslæt og facilitet. */
  function quickShiftDay(booking: BookingDTO, deltaDays: number) {
    setContextMenu(null);
    const newStart = addDays(parseNaiveDateTime(booking.startsAt), deltaDays);
    const newEnd = addDays(parseNaiveDateTime(booking.endsAt), deltaDays);
    applyBookingChange(
      booking,
      { facilityId: booking.facilityId, startsAt: toNaiveDateTimeString(newStart), endsAt: toNaiveDateTimeString(newEnd) },
      false
    );
  }

  /** Slip af en booking (trukket i Ugeplan) på ←/→-knapperne: flytter den en uge tilbage/frem. */
  function dropOnWeekShift(e: React.DragEvent, deltaDays: number) {
    e.preventDefault();
    const id = e.dataTransfer.getData("text/plain");
    const booking = bookings.find((b) => b.id === id);
    if (!booking || isMultiDay(booking)) return;
    quickShiftDay(booking, deltaDays);
  }

  const weekCounts = (t: FacilityTab) => {
    const ids = new Set(t.facilities.map((f) => f.id));
    return bookings.filter((b) => ids.has(b.facilityId) && b.status !== "aflyst" && b.status !== "afvist").length;
  };

  return (
    <div className="p-4 md:px-5 md:py-6">
      {/* Faneblade: hver fane samler de faciliteter, der hører sammen. */}
      <div className="mb-4 flex flex-wrap gap-2" role="tablist" aria-label="Facilitetsgrupper">
        {tabs.map((t) => {
          const active = t.key === activeTab?.key;
          const count = weekCounts(t);
          return (
            <button
              key={t.key}
              role="tab"
              aria-selected={active}
              onClick={() => chooseTab(t.key)}
              className={`group flex items-center gap-2.5 rounded-xl border-2 px-5 py-2.5 text-sm font-bold uppercase tracking-wide transition-all ${
                active ? "text-white shadow-md" : "bg-white text-slate-700 hover:shadow-sm"
              }`}
              style={
                active
                  ? { backgroundColor: t.color, borderColor: t.color }
                  : { borderColor: hexToRgba(t.color, 0.45) }
              }
            >
              <span className="flex -space-x-1">
                {t.facilities.slice(0, 6).map((f) => (
                  <span
                    key={f.id}
                    className="inline-block h-3 w-3 rounded-full border border-white"
                    style={{ backgroundColor: colorMap.get(f.id) ?? f.color ?? "#64748b" }}
                  />
                ))}
              </span>
              {t.label}
              <span
                className={`rounded-full px-2 py-0.5 text-[11px] font-semibold normal-case tracking-normal ${
                  active ? "bg-white/25 text-white" : "bg-slate-100 text-slate-600"
                }`}
                title={view === "dag" ? "Bookinger denne dag" : "Bookinger i den viste uge"}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      <div className="min-w-0">
        {/* Fastfrosset (sticky) værktøjslinje: visningsvalg, dato-navigation og
            det aktuelle datointerval skal altid være synlige, også når man
            scroller langt ned. */}
        <div className="sticky top-0 z-20 -mx-1 bg-slate-50 px-1 py-2 flex flex-wrap items-center justify-between gap-3 mb-3">
          <div className="flex items-center gap-2">
            <div className="inline-flex rounded-lg border border-slate-200 bg-white p-1">
              {(["ugeplan", "dag"] as ViewMode[]).map((v) => (
                <button
                  key={v}
                  onClick={() => setView(v)}
                  className={`px-3 py-1.5 text-sm font-medium rounded-md ${
                    view === v ? "bg-blue-600 text-white" : "text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  {v === "dag" ? "Dagsplan" : "Ugeplan"}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setAnchor((a) => addDays(a, view === "dag" ? -1 : -7))}
                data-day-shift={view === "dag" ? "-1" : undefined}
                onDragOver={view === "ugeplan" ? (e) => e.preventDefault() : undefined}
                onDrop={view === "ugeplan" ? (e) => dropOnWeekShift(e, -7) : undefined}
                title={
                  view === "dag"
                    ? "Forrige dag - træk en booking herhen for at flytte den en dag tilbage"
                    : "Forrige uge - træk en booking herhen for at flytte den en uge tilbage"
                }
                className={`w-8 h-8 rounded-lg border text-slate-600 hover:bg-slate-50 transition-colors ${
                  dayDragActive ? "border-blue-400 bg-blue-50 ring-2 ring-blue-300" : "border-slate-200 bg-white"
                }`}
              >
                &larr;
              </button>
              <button
                onClick={() => setAnchor(new Date())}
                className="px-3 h-8 rounded-lg border border-slate-200 bg-white text-sm text-slate-600 hover:bg-slate-50"
              >
                I dag
              </button>
              <button
                onClick={() => setAnchor((a) => addDays(a, view === "dag" ? 1 : 7))}
                data-day-shift={view === "dag" ? "1" : undefined}
                onDragOver={view === "ugeplan" ? (e) => e.preventDefault() : undefined}
                onDrop={view === "ugeplan" ? (e) => dropOnWeekShift(e, 7) : undefined}
                title={
                  view === "dag"
                    ? "Næste dag - træk en booking herhen for at flytte den en dag frem"
                    : "Næste uge - træk en booking herhen for at flytte den en uge frem"
                }
                className={`w-8 h-8 rounded-lg border text-slate-600 hover:bg-slate-50 transition-colors ${
                  dayDragActive ? "border-blue-400 bg-blue-50 ring-2 ring-blue-300" : "border-slate-200 bg-white"
                }`}
              >
                &rarr;
              </button>
            </div>
            {headerDateLabel && (
              <div className="text-base font-bold text-slate-800 whitespace-nowrap">{headerDateLabel}</div>
            )}
            {loading && <span className="text-xs text-slate-400">Indlæser...</span>}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={toggleSilentMove}
              title="Når den er slået til, kommer flytninger (træk og slip) ikke på aflysningslisten på hjemmesiden, og der sendes ingen mail til foreningen."
              className={`rounded-lg border px-3 py-2 text-sm font-medium ${
                silentMove
                  ? "border-amber-400 bg-amber-100 text-amber-900"
                  : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
              }`}
            >
              🔇 Stille flytning: {silentMove ? "TIL" : "fra"}
            </button>
            <button
              onClick={() => {
                setModalDefaultStart(undefined);
                setModalDefaultFacilityId(undefined);
                setSelectedBooking(null);
                setShowModal(true);
              }}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              + Ny booking
            </button>
          </div>
        </div>

        <CalendarLegend />

        {view === "ugeplan" && (
          <WeekMatrixView
            weekStart={rangeStart}
            groups={tabGroups}
            bookings={visibleBookings}
            organizationName={organizationName}
            onSelect={setSelectedBooking}
            onContextMenu={openContextMenu}
            notesForDay={notesForDay}
            onAddNote={(dateStr) => setNoteModal({ date: dateStr })}
            onEditNote={(note) => setNoteModal({ date: note.date, note })}
            onDayDoubleClick={openNewBookingFor}
            onCommit={(booking, pending) => applyBookingChange(booking, pending, false)}
            onDragActiveChange={setDayDragActive}
          />
        )}
        {view === "dag" && (
          <DayGridView
            day={rangeStart}
            facilities={tabFacilities}
            bookings={visibleBookings}
            organizationName={organizationName}
            onSelect={setSelectedBooking}
            onContextMenu={openContextMenu}
            onDayDoubleClick={openNewBookingFor}
            onCommit={(booking, pending) => applyBookingChange(booking, pending, false)}
            onDragActiveChange={setDayDragActive}
          />
        )}
      </div>

      {showModal && (
        <BookingFormModal
          facilities={facilities}
          organizations={organizations}
          defaultStart={modalDefaultStart}
          defaultFacilityId={modalDefaultFacilityId}
          onClose={() => setShowModal(false)}
          onSaved={() => {
            setShowModal(false);
            loadBookings();
          }}
        />
      )}

      {quickEditBooking && (
        <BookingFormModal
          booking={quickEditBooking}
          facilities={facilities}
          organizations={organizations}
          onClose={() => setQuickEditBooking(null)}
          onSaved={() => {
            setQuickEditBooking(null);
            loadBookings();
          }}
        />
      )}

      {selectedBooking && (
        <BookingDetail
          booking={selectedBooking}
          facilities={facilities}
          organizations={organizations}
          facilityName={facilityName(selectedBooking.facilityId)}
          onClose={() => setSelectedBooking(null)}
          onChanged={() => {
            setSelectedBooking(null);
            loadBookings();
          }}
        />
      )}

      {noteModal && (
        <DayNoteModal
          date={noteModal.date}
          note={noteModal.note}
          onClose={() => setNoteModal(null)}
          onSaved={() => {
            setNoteModal(null);
            loadDayNotes();
          }}
          onDeleted={() => {
            setNoteModal(null);
            loadDayNotes();
          }}
        />
      )}

      {contextMenu && (
        <BookingContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          booking={contextMenu.booking}
          facilityNameStr={facilityName(contextMenu.booking.facilityId)}
          onClose={() => setContextMenu(null)}
          onOpenDetails={() => {
            setContextMenu(null);
            setSelectedBooking(contextMenu.booking);
          }}
          onEdit={() => quickEdit(contextMenu.booking)}
          onToggleImportant={() => quickToggleImportant(contextMenu.booking)}
          hasLight={facilityHasLightControl(contextMenu.booking.facilityId, facilities)}
          onSetLight={(level, wholeSeason) => quickSetLight(contextMenu.booking, level, wholeSeason)}
          onCancelDay={() => quickCancelBooking(contextMenu.booking)}
          onCancelSeason={() => quickCancelSeason(contextMenu.booking)}
          onSilentDelete={() => quickSilentDelete(contextMenu.booking)}
          onSilentDeleteSeason={() => quickSilentDeleteSeason(contextMenu.booking)}
          onMail={() => quickMailOrganizer(contextMenu.booking)}
          onCopyCode={() => quickCopyAccessCode(contextMenu.booking)}
          onMoveTomorrow={() => quickShiftDay(contextMenu.booking, 1)}
          onMoveYesterday={() => quickShiftDay(contextMenu.booking, -1)}
        />
      )}

      {dragConflict && (
        <DragConflictBox
          bookingTitle={dragConflict.booking.title}
          conflicts={dragConflict.conflicts}
          busy={dragBusy}
          onDoubleBook={resolveDragDoubleBook}
          onCancelOriginal={resolveDragCancelOriginal}
          onDismiss={() => {
            setDragConflict(null);
            loadBookings();
          }}
        />
      )}

      {seasonMoveChoice && (
        <SeasonMoveChoiceBox
          bookingTitle={seasonMoveChoice.booking.title}
          onSingleBooking={chooseSingleBookingMove}
          onWholeSeason={chooseSeasonMove}
          onCancel={() => setSeasonMoveChoice(null)}
        />
      )}

      {seasonDragConflict && (
        <SeasonDragConflictBox
          bookingTitle={seasonDragConflict.booking.title}
          conflictsByDate={seasonDragConflict.conflictsByDate}
          busy={seasonMoveBusy}
          onDoubleBook={resolveSeasonDoubleBook}
          onCancelOriginal={resolveSeasonCancelOriginal}
          onDismiss={() => {
            setSeasonDragConflict(null);
            loadBookings();
          }}
        />
      )}
    </div>
  );
}

/**
 * Højreklik-hurtigmenu på en booking: de mest almindelige handlinger uden at
 * skulle åbne den fulde detalje-boks først. Lukker sig selv ved klik uden
 * for, tryk på Escape, eller scroll - ligesom en almindelig kontekstmenu.
 */
function BookingContextMenu({
  x,
  y,
  booking,
  facilityNameStr,
  onClose,
  onOpenDetails,
  onEdit,
  onToggleImportant,
  hasLight,
  onSetLight,
  onCancelDay,
  onCancelSeason,
  onSilentDelete,
  onSilentDeleteSeason,
  onMail,
  onCopyCode,
  onMoveTomorrow,
  onMoveYesterday,
}: {
  x: number;
  y: number;
  booking: BookingDTO;
  facilityNameStr: string;
  onClose: () => void;
  onOpenDetails: () => void;
  onEdit: () => void;
  onToggleImportant: () => void;
  hasLight: boolean;
  onSetLight: (level: number, wholeSeason: boolean) => void;
  onCancelDay: () => void;
  onCancelSeason: () => void;
  onSilentDelete: () => void;
  onSilentDeleteSeason: () => void;
  onMail: () => void;
  onCopyCode: () => void;
  onMoveTomorrow: () => void;
  onMoveYesterday: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const isSeason = !!booking.seasonGroupId;
  const isCancelled = booking.status === "aflyst";

  useEffect(() => {
    // Lille forsinkelse så det klik, der åbnede menuen (via contextmenu-
    // eventet), ikke selv registreres som "klik udenfor" og lukker den igen
    // med det samme.
    const timer = setTimeout(() => {
      window.addEventListener("click", onClose);
      window.addEventListener("contextmenu", onClose);
      window.addEventListener("scroll", onClose, true);
      window.addEventListener("keydown", handleKey);
    }, 0);
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    return () => {
      clearTimeout(timer);
      window.removeEventListener("click", onClose);
      window.removeEventListener("contextmenu", onClose);
      window.removeEventListener("scroll", onClose, true);
      window.removeEventListener("keydown", handleKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Undgår at menuen render's uden for skærmens synlige område ved klik tæt
  // på højre/nederste kant.
  const maxLeft = typeof window !== "undefined" ? window.innerWidth - 248 : x;
  const maxTop = typeof window !== "undefined" ? window.innerHeight - 540 : y;
  const style: CSSProperties = {
    position: "fixed",
    top: Math.max(8, Math.min(y, maxTop)),
    left: Math.max(8, Math.min(x, maxLeft)),
    zIndex: 60,
  };

  const itemClass = "w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-50";

  return (
    <div style={style} className="w-60 rounded-xl border border-slate-200 bg-white shadow-xl py-1" onClick={(e) => e.stopPropagation()}>
      <div className="px-3 py-2 border-b border-slate-100">
        <div className="text-sm font-medium text-slate-900 truncate">{booking.title}</div>
        <div className="text-xs text-slate-400 truncate">{facilityNameStr}</div>
      </div>
      <button className={itemClass} onClick={onOpenDetails}>
        Vis detaljer
      </button>
      <button className={itemClass} onClick={onEdit}>
        Rediger
      </button>
      <button className={itemClass} onClick={onToggleImportant}>
        {booking.important ? "Fjern VIGTIG/KAMP-markering" : "⚑ Markér som VIGTIG/KAMP"}
      </button>
      {hasLight && booking.status !== "aflyst" && booking.status !== "afvist" && (
        <div className="px-3 py-2 border-t border-b border-slate-100 space-y-1.5">
          <div className="text-xs font-medium text-slate-500">💡 Lys i hallen{isSeason ? " (kun denne dag)" : ""}</div>
          <div className="flex gap-1">
            {LIGHT_LEVELS.map((lux) => {
              const active = (booking.lightLevel ?? DEFAULT_LIGHT_LEVEL) === lux;
              return (
                <button
                  key={lux}
                  onClick={() => onSetLight(lux, false)}
                  className={`flex-1 rounded-md border px-1 py-1 text-xs font-medium ${
                    active ? "border-amber-500 bg-amber-400 text-amber-950" : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  {lux}
                </button>
              );
            })}
          </div>
          {isSeason && (
            <>
              <div className="text-xs font-medium text-slate-500 pt-1">💡 Lys resten af sæsonen</div>
              <div className="flex gap-1">
                {LIGHT_LEVELS.map((lux) => (
                  <button
                    key={lux}
                    onClick={() => onSetLight(lux, true)}
                    className="flex-1 rounded-md border border-slate-300 bg-white px-1 py-1 text-xs font-medium text-slate-600 hover:bg-amber-50"
                  >
                    {lux}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}
      {booking.status !== "aflyst" && booking.status !== "afvist" && (
        <>
          <button className={itemClass} onClick={onMoveTomorrow}>
            Flyt til i morgen
          </button>
          <button className={itemClass} onClick={onMoveYesterday}>
            Flyt til i går
          </button>
        </>
      )}
      {booking.contactEmail && (
        <button className={itemClass} onClick={onMail}>
          Send mail til arrangør
        </button>
      )}
      {booking.accessCode && (
        <button
          className={itemClass}
          onClick={() => {
            onCopyCode();
            setCopied(true);
          }}
        >
          {copied ? "Dørkode kopieret!" : "Kopiér dørkode"}
        </button>
      )}
      {!isCancelled && (
        <>
          <div className="border-t border-slate-100 my-1" />
          <button className={`${itemClass} text-red-600`} onClick={onCancelDay}>
            {isSeason ? "Aflys kun denne dag" : "Aflys booking"}
          </button>
          {isSeason && (
            <button className={`${itemClass} text-red-600`} onClick={onCancelSeason}>
              Aflys hele sæsonen
            </button>
          )}
          <button
            className={`${itemClass} text-slate-500`}
            onClick={onSilentDelete}
            title="Fjerner bookingen uden at den kommer på aflysningslisten og uden mail"
          >
            🔇 {isSeason ? "Slet kun denne dag stille" : "Slet stille"}
          </button>
          {isSeason && (
            <button className={`${itemClass} text-slate-500`} onClick={onSilentDeleteSeason}>
              🔇 Slet hele sæsonen stille
            </button>
          )}
        </>
      )}
    </div>
  );
}

/**
 * Dagsnoter (fx "Tekniker kommer til ventilationen kl. 10") vist som gule
 * bjælker øverst i en dagscelle - genbruges af både uge- og månedsvisningen.
 * Klik åbner noten til redigering/sletning (se DayNoteModal).
 */
function DayNoteBadges({ notes, onEditNote }: { notes: DayNoteDTO[]; onEditNote: (note: DayNoteDTO) => void }) {
  if (notes.length === 0) return null;
  return (
    <div className="px-1.5 pt-1.5 space-y-1">
      {notes.map((n) => (
        <button
          key={n.id}
          onClick={(e) => {
            e.stopPropagation();
            onEditNote(n);
          }}
          className="w-full text-left rounded-md bg-amber-50 border border-amber-200 px-1.5 py-1 text-[11px] text-amber-800 hover:bg-amber-100"
          title="Rediger dagsnote"
        >
          {n.text}
        </button>
      ))}
    </div>
  );
}

const DAY_GRID_START_MIN = 6 * 60; // 06.00
const DAY_GRID_END_MIN = 24 * 60; // 24.00
const DAY_GRID_PX_PER_MIN = 0.8; // 48px pr. time

type DayDragMode = "move" | "resize-top" | "resize-bottom";

interface DayDragState {
  bookingId: string;
  mode: DayDragMode;
  startClientY: number;
  originFacilityId: string;
  originStartMin: number;
  originEndMin: number;
  currentFacilityId: string;
  currentStartMin: number;
  currentEndMin: number;
  dayShift: number;
}

/**
 * Dagsplan: én dag ad gangen, med de valgte faciliteter side om side som
 * kolonner og klokkeslæt ned ad y-aksen (et rigtigt ressourcekalender-skema,
 * ligesom GIBBS') - i modsætning til de øvrige visninger, der viser
 * bookinger som en simpel stak kort uden tidsakse. Kun her giver det mening
 * at trække en booking til et nyt tidspunkt eller trække i kanten for at
 * forlænge/afkorte den, da det kræver en visuel tidsakse (Martin efterspurgte
 * træk-og-slip til en anden hal, et senere tidspunkt, dagen efter, samt at
 * kunne trække i kanten for at udvide/afkorte en booking).
 *
 * - Træk selve kortet: flytter bookingen til et nyt klokkeslæt (rundet til
 *   nærmeste halve time) og/eller en anden facilitet-kolonne.
 * - Træk hen over pil-knapperne i værktøjslinjen ("forrige/næste dag"):
 *   flytter bookingen en hel dag frem eller tilbage, uændret klokkeslæt/hal.
 * - Træk i kortets top- eller bundkant: forlænger/afkorter bookingen (også i
 *   halve timer), uden at flytte den modsatte ende.
 *
 * Konflikt ved slip håndteres af `onCommit` i CalendarClient med samme
 * to-valgsboks ("Dobbeltbook"/"Aflys den oprindelige booking") som ved
 * almindelig redigering af en booking.
 */
function DayGridView({
  day,
  facilities,
  bookings,
  organizationName,
  onSelect,
  onContextMenu,
  onDayDoubleClick,
  onCommit,
  onDragActiveChange,
}: {
  day: Date;
  facilities: FacilityDTO[];
  bookings: BookingDTO[];
  organizationName: (id: string | null) => string | undefined;
  onSelect: (b: BookingDTO) => void;
  onContextMenu: (e: ReactMouseEvent, b: BookingDTO) => void;
  onDayDoubleClick: (dateStr: string, facilityId?: string, timeHHMM?: string) => void;
  onCommit: (booking: BookingDTO, pending: { facilityId: string; startsAt: string; endsAt: string }) => void;
  onDragActiveChange: (active: boolean) => void;
}) {
  const dayStr = localISODate(day);
  const [drag, setDrag] = useState<DayDragState | null>(null);
  const dragRef = useRef<DayDragState | null>(null);
  const bookingsRef = useRef<BookingDTO[]>(bookings);

  useEffect(() => {
    dragRef.current = drag;
  }, [drag]);

  useEffect(() => {
    bookingsRef.current = bookings;
  }, [bookings]);

  useEffect(() => {
    onDragActiveChange(drag !== null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag !== null]);

  const dayBookings = bookings.filter(
    (b) => bookingOnDay(b, dayStr) && b.status !== "aflyst" && b.status !== "afvist"
  );

  // Tidsaksens grænser udvides automatisk, hvis en booking rækker udenfor
  // standardintervallet (06.00-24.00), så intet nogensinde beskæres.
  let gridStartMin = DAY_GRID_START_MIN;
  let gridEndMin = DAY_GRID_END_MIN;
  for (const b of dayBookings) {
    const { startMin: s, endMin: e } = daySegment(b, dayStr);
    if (s < gridStartMin) gridStartMin = Math.floor(s / 60) * 60;
    if (e > gridEndMin) gridEndMin = Math.ceil(e / 60) * 60;
  }

  const totalMinutes = gridEndMin - gridStartMin;
  const gridHeight = totalMinutes * DAY_GRID_PX_PER_MIN;
  const hourMarks = Array.from({ length: totalMinutes / 60 + 1 }, (_, i) => gridStartMin + i * 60);

  function startDrag(e: ReactPointerEvent, booking: BookingDTO, mode: DayDragMode) {
    // Kun venstre museknap/primær pointer skal starte et træk - ellers vil et
    // højreklik (som også udløser en pointerdown) blive tolket som et
    // "klik uden bevægelse" i onUp og åbne detalje-boksen i stedet for at
    // lade den almindelige onContextMenu-håndtering vise højreklik-menuen.
    if (e.button !== 0) return;
    // Flerdagsbookinger kan ikke trækkes her (klik åbner dem) - ændres via redigering.
    if (isMultiDay(booking)) return;
    e.stopPropagation();
    e.preventDefault();
    const start = parseNaiveDateTime(booking.startsAt);
    const end = parseNaiveDateTime(booking.endsAt);
    const initial: DayDragState = {
      bookingId: booking.id,
      mode,
      startClientY: e.clientY,
      originFacilityId: booking.facilityId,
      originStartMin: minutesOfDay(start),
      originEndMin: minutesOfDay(end),
      currentFacilityId: booking.facilityId,
      currentStartMin: minutesOfDay(start),
      currentEndMin: minutesOfDay(end),
      dayShift: 0,
    };
    // Skrives synkront (se kommentar i `computeNext`), så et hurtigt træk der
    // sender ned/op-events i samme tick ikke risikerer at `onUp` læser en tom
    // `dragRef` fra før Reacts effekt har nået at køre.
    dragRef.current = initial;
    setDrag(initial);
  }

  // Udregner den nye tilstand ud fra en klientkoordinat. Bruges BÅDE løbende
  // under trækket (onMove, til visuel feedback) OG én sidste gang i selve
  // "slip"-eventet (onUp) med SLIPPETS EGNE koordinater - nogle
  // automatiserings-/input-kilder sender kun et "ned" og et "op"-event uden
  // nogen mellemliggende bevægelses-events, og hvis `onUp` kun genbruger den
  // sidst kendte `onMove`-tilstand, vil trækket i så fald fejlagtigt blive
  // opfattet som "ingen bevægelse" og tolket som et almindeligt klik.
  function computeNext(prev: DayDragState, clientX: number, clientY: number): DayDragState {
    const deltaY = clientY - prev.startClientY;
    const snappedDeltaMin = Math.round(deltaY / DAY_GRID_PX_PER_MIN / 30) * 30;

    let facilityId = prev.originFacilityId;
    let dayShift = 0;
    const el = document.elementFromPoint(clientX, clientY) as HTMLElement | null;
    const col = el?.closest("[data-facility-col]") as HTMLElement | null;
    if (prev.mode === "move" && col?.dataset.facilityCol) facilityId = col.dataset.facilityCol;
    const shiftEl = el?.closest("[data-day-shift]") as HTMLElement | null;
    if (prev.mode === "move" && shiftEl?.dataset.dayShift) dayShift = Number(shiftEl.dataset.dayShift);

    let startMin = prev.originStartMin;
    let endMin = prev.originEndMin;
    if (dayShift !== 0) {
      // Når kortet trækkes hen over forrige/næste-dag-pilen, skal klokkeslættet
      // (og faciliteten) IKKE ændres - kun dagen flyttes. Pilene sidder langt
      // over selve gitteret, så den lodrette afstand dertil er ikke retningen
      // brugeren har til hensigt at ændre tidspunktet med.
    } else if (prev.mode === "move") {
      const duration = prev.originEndMin - prev.originStartMin;
      startMin = clampMinutes(prev.originStartMin + snappedDeltaMin, gridStartMin, gridEndMin - duration);
      endMin = startMin + duration;
    } else if (prev.mode === "resize-bottom") {
      endMin = clampMinutes(prev.originEndMin + snappedDeltaMin, prev.originStartMin + 30, gridEndMin);
    } else if (prev.mode === "resize-top") {
      startMin = clampMinutes(prev.originStartMin + snappedDeltaMin, gridStartMin, prev.originEndMin - 30);
    }

    return { ...prev, currentFacilityId: facilityId, currentStartMin: startMin, currentEndMin: endMin, dayShift };
  }

  useEffect(() => {
    if (!drag) return undefined;

    function handleMove(clientX: number, clientY: number) {
      const prev = dragRef.current;
      if (!prev) return;
      const next = computeNext(prev, clientX, clientY);
      dragRef.current = next;
      setDrag(next);
    }

    function handleUp(clientX: number, clientY: number) {
      const prev = dragRef.current;
      dragRef.current = null;
      setDrag(null);
      if (!prev) return;
      // Genberegn ud fra SLIPPETS egne koordinater (se kommentar ved
      // `computeNext`) i stedet for kun at stole på `prev`, som kan være
      // uændret hvis der ingen mellemliggende bevægelses-events kom.
      const final = computeNext(prev, clientX, clientY);
      const booking = bookingsRef.current.find((b) => b.id === final.bookingId);
      if (!booking) return;
      const nothingChanged =
        final.currentFacilityId === final.originFacilityId &&
        final.currentStartMin === final.originStartMin &&
        final.currentEndMin === final.originEndMin &&
        final.dayShift === 0;
      if (nothingChanged) {
        onSelect(booking);
        return;
      }
      const targetDayStr = final.dayShift !== 0 ? localISODate(addDays(day, final.dayShift)) : dayStr;
      onCommit(booking, {
        facilityId: final.currentFacilityId,
        startsAt: minutesToNaiveDateTimeString(targetDayStr, final.currentStartMin),
        endsAt: minutesToNaiveDateTimeString(targetDayStr, final.currentEndMin),
      });
    }

    // Lytter til BÅDE pointer- og mouse-events: almindelige fysiske
    // museklik/-træk udløser normalt begge (browseren sender et
    // "compat"-museevent efter pointer-eventet), men nogle synteste
    // input-kilder (automatiserede test-værktøjer m.m.) springer det ene sæt
    // helt over. `dragRef.current` bliver nullet i `handleUp`, så et
    // eventuelt duplikeret op-kald bagefter er en harmløs no-op.
    function onPointerMove(e: PointerEvent) {
      handleMove(e.clientX, e.clientY);
    }
    function onPointerUp(e: PointerEvent) {
      handleUp(e.clientX, e.clientY);
    }
    function onMouseMove(e: MouseEvent) {
      handleMove(e.clientX, e.clientY);
    }
    function onMouseUp(e: MouseEvent) {
      handleUp(e.clientX, e.clientY);
    }

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag !== null]);

  if (facilities.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-200 p-10 text-center text-slate-400">
        Ingen faciliteter i denne fane.
      </div>
    );
  }

  return (
    <div className="select-none">
      <div className="overflow-x-auto pb-2">
      <div className="flex min-w-full items-start">
        {/* Tidsakse-gutter */}
        <div className="w-12 shrink-0 relative" style={{ height: gridHeight + 32 }}>
          {hourMarks.map((m) => (
            <div
              key={m}
              className="absolute right-1 -translate-y-1/2 text-[11px] text-slate-400"
              style={{ top: 32 + (m - gridStartMin) * DAY_GRID_PX_PER_MIN }}
            >
              {String(Math.floor(m / 60) % 24).padStart(2, "0")}.00
            </div>
          ))}
        </div>
        {facilities.map((f) => (
          <div key={f.id} className="flex-1 min-w-[170px] max-w-[420px] px-1">
            <div
              className="h-8 flex items-center justify-center gap-1.5 rounded-t-lg text-xs font-semibold text-slate-800 truncate"
              style={{ backgroundColor: hexToRgba(f.color ?? "#64748b", 0.16) }}
            >
              <span className="inline-block w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: f.color ?? "#64748b" }} />
              {f.name}
            </div>
            <div
              data-facility-col={f.id}
              onDoubleClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const offsetMin = gridStartMin + (e.clientY - rect.top) / DAY_GRID_PX_PER_MIN;
                const snapped = clampMinutes(Math.round(offsetMin / 30) * 30, gridStartMin, gridEndMin - 30);
                const hh = String(Math.floor(snapped / 60) % 24).padStart(2, "0");
                const mm = String(snapped % 60).padStart(2, "0");
                onDayDoubleClick(dayStr, f.id, `${hh}:${mm}`);
              }}
              title="Dobbeltklik for at oprette en booking på dette tidspunkt"
              className="relative rounded-b-lg border border-slate-200 bg-white cursor-pointer"
              style={{ height: gridHeight }}
            >
              {hourMarks.map((m) => (
                <div
                  key={m}
                  className="absolute left-0 right-0 border-t border-slate-100 pointer-events-none"
                  style={{ top: (m - gridStartMin) * DAY_GRID_PX_PER_MIN }}
                />
              ))}
              {dayBookings
                .filter((b) => {
                  const isDragged = drag?.bookingId === b.id;
                  const displayFacilityId = isDragged ? (drag as DayDragState).currentFacilityId : b.facilityId;
                  return displayFacilityId === f.id;
                })
                .map((b) => {
                  const isDragged = drag?.bookingId === b.id;
                  const seg = daySegment(b, dayStr, gridStartMin);
                  const startMin = isDragged ? (drag as DayDragState).currentStartMin : seg.startMin;
                  const endMin = isDragged ? (drag as DayDragState).currentEndMin : seg.endMin;
                  const top = (startMin - gridStartMin) * DAY_GRID_PX_PER_MIN;
                  const height = Math.max(22, (endMin - startMin) * DAY_GRID_PX_PER_MIN);
                  return (
                    <div
                      key={b.id}
                      onPointerDown={(e) => startDrag(e, b, "move")}
                      onClick={isMultiDay(b) ? () => onSelect(b) : undefined}
                      onContextMenu={(e) => onContextMenu(e, b)}
                      title={bookingTooltip(b, f.name, organizationName(b.organizationId))}
                      style={{
                        position: "absolute",
                        top,
                        height,
                        left: 2,
                        right: 2,
                        touchAction: "none",
                        zIndex: isDragged ? 30 : 10,
                        ...bookingVisual(f.color ?? "#64748b", b).style,
                      }}
                      className={`rounded-lg px-1.5 py-1 text-[11px] overflow-hidden cursor-grab active:cursor-grabbing shadow-sm ${bookingVisual(f.color ?? "#64748b", b).className} ${isDragged ? "opacity-90 ring-2 ring-blue-400" : ""}`}
                    >
                      <div
                        onPointerDown={(e) => startDrag(e, b, "resize-top")}
                        className="absolute top-0 left-0 right-0 h-2 cursor-ns-resize"
                        style={{ touchAction: "none" }}
                      />
                      <div className="font-medium truncate leading-tight">
                        {b.important && <span className="mr-0.5">⚑</span>}
                        {b.seasonGroupId && <span className="mr-0.5">↻</span>}
                        {b.lightLevel && b.lightLevel !== 400 && <span className="mr-0.5" title={`Lys: ${b.lightLevel} lux`}>💡{b.lightLevel}</span>}
                        {b.title}
                      </div>
                      <div className="opacity-75 leading-tight">
                        {isMultiDay(b) ? (
                          dayTimeLabel(b, dayStr)
                        ) : (
                          <>
                            {String(Math.floor(startMin / 60) % 24).padStart(2, "0")}.{String(startMin % 60).padStart(2, "0")}-
                            {String(Math.floor(endMin / 60) % 24).padStart(2, "0")}.{String(endMin % 60).padStart(2, "0")}
                          </>
                        )}
                      </div>
                      <div
                        onPointerDown={(e) => startDrag(e, b, "resize-bottom")}
                        className="absolute bottom-0 left-0 right-0 h-2 cursor-ns-resize"
                        style={{ touchAction: "none" }}
                      />
                    </div>
                  );
                })}
            </div>
          </div>
        ))}
      </div>
      </div>
      <div className="text-xs text-slate-400 mt-2">
        Træk et kort for at flytte det til et andet tidspunkt eller en anden facilitet - eller hen over ←/→-knapperne
        for at flytte det til forrige/næste dag. Træk i kortets top- eller bundkant for at forlænge/afkorte det.
      </div>
    </div>
  );
}

/** Lille nøgle der forklarer kortenes udseende: enkeltbooking, sæson, kamp og afventer. */
function CalendarLegend() {
  const demo = "#2563eb";
  const solid = bookingVisual(demo, { status: "bekraeftet", seasonGroupId: null, important: false } as BookingDTO);
  const season = bookingVisual(demo, { status: "bekraeftet", seasonGroupId: "x", important: false } as BookingDTO);
  const waiting = bookingVisual(demo, { status: "afventer_godkendelse", seasonGroupId: null, important: false } as BookingDTO);
  const important = bookingVisual(demo, { status: "bekraeftet", seasonGroupId: null, important: true } as BookingDTO);
  const chip = "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold";
  return (
    <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-slate-500">
      <span className="font-semibold uppercase tracking-wide text-slate-400">Forklaring</span>
      <span className={`${chip} ${solid.className}`} style={solid.style}>
        Enkeltbooking
      </span>
      <span className={`${chip} ${season.className}`} style={season.style}>
        ↻ Sæsonbooking (gentages ugentligt)
      </span>
      <span className={`${chip} ${important.className}`} style={important.style}>
        ⚑ Vigtig/kamp
      </span>
      <span className={`${chip} ${waiting.className}`} style={waiting.style}>
        Afventer
      </span>
      <span className="text-slate-400">Dobbeltklik i en celle for at oprette en booking. Højreklik på en booking for hurtige handlinger.</span>
    </div>
  );
}

const WEEKDAY_FULL = ["Mandag", "Tirsdag", "Onsdag", "Torsdag", "Fredag", "Lørdag", "Søndag"];

function fmtHM(min: number): string {
  return `${String(Math.floor(min / 60) % 24).padStart(2, "0")}.${String(min % 60).padStart(2, "0")}`;
}

/** Pixels pr. minut i ugeplanens tidsakse (51 px pr. time). */
const WEEK_PX_PER_MIN = 0.85;
const WEEK_DEFAULT_START_MIN = 7 * 60;
const WEEK_DEFAULT_END_MIN = 22 * 60;
/** Højde på den lille overskriftslinje med facilitetsnavne, når to faciliteter vises side om side. */
const WEEK_TAG_H = 20;

/** Fordeler overlappende bookinger i samme facilitet/dag i baner side om side. */
function layoutCell(
  items: { id: string; startMin: number; endMin: number }[]
): Map<string, { lane: number; laneCount: number }> {
  const sorted = [...items].sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);
  const out = new Map<string, { lane: number; laneCount: number }>();
  let cluster: typeof sorted = [];
  let clusterEnd = -1;
  function flush() {
    if (cluster.length === 0) return;
    const laneEnds: number[] = [];
    const assigned: { id: string; lane: number }[] = [];
    for (const ev of cluster) {
      let lane = laneEnds.findIndex((end) => end <= ev.startMin);
      if (lane === -1) {
        lane = laneEnds.length;
        laneEnds.push(ev.endMin);
      } else {
        laneEnds[lane] = ev.endMin;
      }
      assigned.push({ id: ev.id, lane });
    }
    for (const a of assigned) out.set(a.id, { lane: a.lane, laneCount: laneEnds.length });
    cluster = [];
    clusterEnd = -1;
  }
  for (const ev of sorted) {
    if (cluster.length > 0 && ev.startMin >= clusterEnd) flush();
    cluster.push(ev);
    clusterEnd = Math.max(clusterEnd, ev.endMin);
  }
  flush();
  return out;
}

/**
 * Ugeplan: ugens 7 dage som kolonner og en række pr. facilitet (eller gruppe af
 * faciliteter side om side, fx de to 20x40 m haller). Inde i hver række er der en
 * TIDSAKSE ligesom i Dagsplan, så bookingerne står på deres rigtige klokkeslæt, og
 * det er tydeligt, hvornår en hal er ledig. Man ruller ned for at se de næste
 * rækker (fx Multisalen).
 *
 * - Klik: åbner bookingen. Højreklik: hurtigmenu. Dobbeltklik et tidspunkt: ny
 *   booking på det tidspunkt.
 * - Træk et kort: flytter det til et nyt tidspunkt (rundet til en halv time), en anden
 *   dag og/eller en anden facilitet. Træk det hen på ←/→-knapperne: flytter det en
 *   uge. Forlænge/afkorte en booking sker i Dagsplan eller via "Rediger".
 */
function WeekMatrixView({
  weekStart,
  groups,
  bookings,
  organizationName,
  onSelect,
  onContextMenu,
  notesForDay,
  onAddNote,
  onEditNote,
  onDayDoubleClick,
  onCommit,
  onDragActiveChange,
}: {
  weekStart: Date;
  /** Rækker: hver gruppe er én række; en gruppe med flere faciliteter vises side om side i hver dag. */
  groups: FacilityDTO[][];
  bookings: BookingDTO[];
  organizationName: (id: string | null) => string | undefined;
  onSelect: (b: BookingDTO) => void;
  onContextMenu: (e: ReactMouseEvent, b: BookingDTO) => void;
  notesForDay: (dateStr: string) => DayNoteDTO[];
  onAddNote: (dateStr: string) => void;
  onEditNote: (note: DayNoteDTO) => void;
  onDayDoubleClick: (dateStr: string, facilityId?: string, timeHHMM?: string) => void;
  onCommit: (booking: BookingDTO, pending: { facilityId: string; startsAt: string; endsAt: string }) => void;
  onDragActiveChange: (active: boolean) => void;
}) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const dayStrs = days.map((d) => localISODate(d));
  const todayStr = localISODate();
  const [dropKey, setDropKey] = useState<string | null>(null);
  const grabOffsetRef = useRef(0);
  const [, setTick] = useState(0);

  useEffect(() => {
    // Holder "nu"-stregen opdateret.
    const t = setInterval(() => setTick((x) => x + 1), 60000);
    return () => clearInterval(t);
  }, []);

  const live = bookings.filter((b) => b.status !== "aflyst" && b.status !== "afvist");

  // Tidsaksens udstrækning: som standard 07-22, men udvides hvis der er bookinger udenfor.
  let gridStartMin = WEEK_DEFAULT_START_MIN;
  let gridEndMin = WEEK_DEFAULT_END_MIN;
  for (const b of live) {
    for (const d of dayStrs) {
      if (!bookingOnDay(b, d)) continue;
      const seg = daySegment(b, d, WEEK_DEFAULT_START_MIN);
      if (seg.startMin < gridStartMin) gridStartMin = Math.floor(seg.startMin / 60) * 60;
      if (seg.endMin > gridEndMin) gridEndMin = Math.ceil(seg.endMin / 60) * 60;
    }
  }
  const totalMin = gridEndMin - gridStartMin;
  const gridH = totalMin * WEEK_PX_PER_MIN;
  const hourMarks = Array.from({ length: totalMin / 60 + 1 }, (_, i) => gridStartMin + i * 60);
  const nowDate = new Date();
  const nowMin = nowDate.getHours() * 60 + nowDate.getMinutes();

  function cellItems(facilityId: string, dayStr: string) {
    return live
      .filter((b) => b.facilityId === facilityId && bookingOnDay(b, dayStr))
      .map((b) => ({ b, ...daySegment(b, dayStr, gridStartMin) }));
  }

  function timeFromY(e: { clientY: number; currentTarget: HTMLElement }, offsetPx = 0): number {
    const rect = e.currentTarget.getBoundingClientRect();
    return gridStartMin + (e.clientY - rect.top - offsetPx) / WEEK_PX_PER_MIN;
  }

  function handleDrop(e: React.DragEvent<HTMLElement>, dayStr: string, facilityId: string) {
    e.preventDefault();
    e.stopPropagation();
    setDropKey(null);
    onDragActiveChange(false);
    const id = e.dataTransfer.getData("text/plain");
    const booking = bookings.find((b) => b.id === id);
    if (!booking || isMultiDay(booking)) return;
    const duration = minutesOfDay(parseNaiveDateTime(booking.endsAt)) - minutesOfDay(parseNaiveDateTime(booking.startsAt));
    const raw = timeFromY(e, grabOffsetRef.current);
    const snapped = clampMinutes(Math.round(raw / 30) * 30, 0, 24 * 60 - Math.max(duration, 30));
    const startsAt = minutesToNaiveDateTimeString(dayStr, snapped);
    const endsAt = minutesToNaiveDateTimeString(dayStr, snapped + duration);
    if (startsAt === booking.startsAt && endsAt === booking.endsAt && facilityId === booking.facilityId) return;
    onCommit(booking, { facilityId, startsAt, endsAt });
  }

  if (groups.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-200 p-10 text-center text-slate-400">
        Ingen faciliteter i denne fane.
      </div>
    );
  }

  // Er der faciliteter side om side, får dagskolonnerne lidt mere plads, så begge halvdele kan læses.
  const hasSideBySide = groups.some((g) => g.length > 1);
  const gridCols = {
    gridTemplateColumns: hasSideBySide
      ? "10rem 3rem repeat(7, minmax(11rem, 1fr))"
      : "10rem 3rem repeat(7, minmax(9.5rem, 1fr))",
  } as CSSProperties;

  function renderCell(f: FacilityDTO, dayStr: string, i: number, grouped: boolean, outerIdx: number) {
    const color = f.color ?? "#64748b";
    const allItems = cellItems(f.id, dayStr);
    // Flerdagsbookinger vises som en smal lodret bjælke i venstre side, så de ikke presser dagens øvrige bookinger sammen.
    const multiItems = allItems.filter((x) => isMultiDay(x.b));
    const items = allItems.filter((x) => !isMultiDay(x.b));
    const stripW = multiItems.length > 0 ? 22 : 0;
    const layout = layoutCell(items.map((x) => ({ id: x.b.id, startMin: x.startMin, endMin: x.endMin })));
    const isToday = dayStr === todayStr;
    const key = `${f.id}|${dayStr}`;
    const base = isToday ? "bg-blue-100" : i % 2 === 1 ? "bg-slate-100" : "bg-white";
    return (
      <div
        key={key}
        data-day-col={dayStr}
        onDoubleClick={(e) => {
          const snapped = clampMinutes(Math.round(timeFromY(e) / 30) * 30, gridStartMin, gridEndMin - 30);
          onDayDoubleClick(dayStr, f.id, `${String(Math.floor(snapped / 60) % 24).padStart(2, "0")}:${String(snapped % 60).padStart(2, "0")}`);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          if (dropKey !== key) setDropKey(key);
        }}
        onDragLeave={() => setDropKey((k) => (k === key ? null : k))}
        onDrop={(e) => handleDrop(e, dayStr, f.id)}
        title={`Dobbeltklik for at oprette en booking i ${f.name}`}
        className={`relative min-w-0 cursor-pointer ${grouped ? "flex-1" : "w-full"} ${
          grouped && outerIdx > 0 ? "border-l border-dashed border-slate-400/60" : ""
        } ${base} ${dropKey === key ? "outline outline-2 -outline-offset-2 outline-blue-500" : ""}`}
        style={{
          height: gridH,
          ...(grouped
            ? { backgroundImage: `linear-gradient(${hexToRgba(color, 0.08)}, ${hexToRgba(color, 0.08)})` }
            : {}),
        }}
      >
        {hourMarks.map((m) => (
          <div
            key={m}
            className="absolute left-0 right-0 border-t border-slate-300/70 pointer-events-none"
            style={{ top: (m - gridStartMin) * WEEK_PX_PER_MIN }}
          />
        ))}
        {isToday && nowMin >= gridStartMin && nowMin <= gridEndMin && (
          <div
            className="absolute left-0 right-0 border-t-2 border-red-500 pointer-events-none z-20"
            style={{ top: (nowMin - gridStartMin) * WEEK_PX_PER_MIN }}
          />
        )}
        {multiItems.map(({ b, startMin, endMin }) => {
          const v = bookingVisual(color, b);
          const org = organizationName(b.organizationId);
          return (
            <div
              key={b.id}
              onClick={(e) => {
                e.stopPropagation();
                onSelect(b);
              }}
              onDoubleClick={(e) => e.stopPropagation()}
              onContextMenu={(e) => onContextMenu(e, b)}
              title={bookingTooltip(b, f.name, org)}
              className={`absolute left-px cursor-pointer overflow-hidden rounded-md py-1 shadow-sm hover:shadow-md ${v.className}`}
              style={{
                top: (startMin - gridStartMin) * WEEK_PX_PER_MIN,
                height: Math.max(24, (endMin - startMin) * WEEK_PX_PER_MIN - 1),
                width: stripW - 2,
                ...v.style,
              }}
            >
              <div
                className="text-[11.5px] font-semibold leading-tight whitespace-nowrap"
                style={{ writingMode: "vertical-rl", maxHeight: "100%", margin: "0 auto" }}
              >
                {b.important ? "⚑ " : ""}
                {b.title} · {dayTimeLabel(b, dayStr)}
              </div>
            </div>
          );
        })}
        {items.map(({ b, startMin, endMin }) => {
          const v = bookingVisual(color, b);
          const multi = false;
          const org = organizationName(b.organizationId);
          const season = !!b.seasonGroupId;
          const top = (startMin - gridStartMin) * WEEK_PX_PER_MIN;
          const height = Math.max(24, (endMin - startMin) * WEEK_PX_PER_MIN - 1);
          const lane = layout.get(b.id) ?? { lane: 0, laneCount: 1 };
          const timeLabel = `${fmtHM(startMin)}–${fmtHM(endMin)}`;
          const tall = height >= 44;
          return (
            <div
              key={b.id}
              draggable={!multi}
              onDragStart={(e) => {
                e.dataTransfer.setData("text/plain", b.id);
                e.dataTransfer.effectAllowed = "move";
                grabOffsetRef.current = e.clientY - e.currentTarget.getBoundingClientRect().top;
                onDragActiveChange(true);
              }}
              onDragEnd={() => {
                setDropKey(null);
                onDragActiveChange(false);
              }}
              onClick={(e) => {
                e.stopPropagation();
                onSelect(b);
              }}
              onDoubleClick={(e) => e.stopPropagation()}
              onContextMenu={(e) => onContextMenu(e, b)}
              title={bookingTooltip(b, f.name, org)}
              className={`absolute overflow-hidden rounded-md px-1 py-0.5 shadow-sm hover:shadow-md hover:z-10 transition-shadow ${
                multi ? "cursor-pointer" : "cursor-grab active:cursor-grabbing"
              } ${v.className}`}
              style={{
                top,
                height,
                left: `calc(${stripW}px + (100% - ${stripW}px) * ${lane.lane / lane.laneCount} + 1px)`,
                width: `calc((100% - ${stripW}px) * ${1 / lane.laneCount} - 2px)`,
                ...v.style,
              }}
            >
              {tall ? (
                <>
                  <div className="text-[11.5px] font-bold leading-tight whitespace-nowrap tabular-nums">{timeLabel}</div>
                  <div className="text-[12px] font-semibold leading-tight break-words">
                    {b.important && <span title="VIGTIG/KAMP">⚑ </span>}
                    {season && <span title="Sæsonbooking - gentages ugentligt">↻ </span>}
                    {b.lightLevel && b.lightLevel !== 400 && <span title={`Lys: ${b.lightLevel} lux`}>💡{b.lightLevel} </span>}
                    {b.title}
                  </div>
                  {org && height >= 72 && <div className="text-[10.5px] leading-tight opacity-80 truncate">{org}</div>}
                  {WAITING_STATUSES.has(b.status) && height >= 72 && (
                    <div className="mt-0.5 inline-block rounded bg-amber-300/90 px-1 text-[10px] font-bold text-amber-900">
                      {BOOKING_STATUS_LABELS[b.status] ?? "Afventer"}
                    </div>
                  )}
                </>
              ) : (
                <div className="text-[11px] font-semibold leading-tight truncate">
                  <span className="tabular-nums font-bold">{fmtHM(startMin)}</span> {b.important ? "⚑ " : ""}
                  {season ? "↻ " : ""}
                  {b.lightLevel && b.lightLevel !== 400 ? `💡${b.lightLevel} ` : ""}
                  {b.title}
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white overflow-auto max-h-[calc(100vh-13rem)] shadow-sm">
      <div className="grid min-w-max md:min-w-full" style={gridCols}>
        {/* Dag-overskrifter (fastfrosset øverst) */}
        <div className="sticky top-0 left-0 z-40 bg-slate-100 border-b border-r border-slate-200 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
          Facilitet
        </div>
        <div className="sticky top-0 left-[10rem] z-40 bg-slate-100 border-b border-r border-slate-200" />
        {days.map((d, i) => {
          const dayStr = dayStrs[i];
          const isToday = dayStr === todayStr;
          return (
            <div
              key={dayStr}
              className={`sticky top-0 z-30 border-b border-slate-300 px-2 py-2 ${i < 6 ? "border-r-2 border-r-slate-400" : ""} ${
                isToday ? "bg-blue-600 text-white" : i % 2 === 1 ? "bg-slate-300 text-slate-900" : "bg-slate-100 text-slate-800"
              }`}
            >
              <div className="flex items-center justify-between gap-1">
                <div className="leading-tight">
                  <div className="text-sm font-bold">{WEEKDAY_FULL[i]}</div>
                  <div className={`text-xs ${isToday ? "text-blue-100" : "text-slate-600"}`}>
                    {d.getDate()}. {d.toLocaleDateString("da-DK", { month: "short" })}
                    {isToday ? " · i dag" : ""}
                  </div>
                </div>
                <button
                  onClick={() => onAddNote(dayStr)}
                  title="Tilføj dagsnote"
                  className={`text-[11px] leading-none px-1.5 py-1 rounded ${
                    isToday ? "text-blue-100 hover:bg-blue-500" : "text-slate-500 hover:text-amber-700 hover:bg-amber-100"
                  }`}
                >
                  +note
                </button>
              </div>
            </div>
          );
        })}

        {/* Dagsnoter */}
        {dayStrs.some((d) => notesForDay(d).length > 0) && (
          <>
            <div className="sticky left-0 z-10 bg-amber-50 border-b border-r border-amber-200 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-amber-700">
              Dagsnoter
            </div>
            <div className="sticky left-[10rem] z-10 bg-amber-50 border-b border-r border-amber-200" />
            {dayStrs.map((dayStr, i) => (
              <div
                key={`n-${dayStr}`}
                className={`bg-amber-50/60 border-b border-amber-100 pb-1.5 ${i < 6 ? "border-r-2 border-r-slate-400" : ""}`}
              >
                <DayNoteBadges notes={notesForDay(dayStr)} onEditNote={onEditNote} />
              </div>
            ))}
          </>
        )}

        {/* Facilitetsrækker (en række kan have flere faciliteter side om side) */}
        {groups.map((g) => {
          const grouped = g.length > 1;
          const first = g[0];
          const color = first.color ?? "#64748b";
          const nm = shortFacilityName(first.name);
          const tagH = grouped ? WEEK_TAG_H : 0;
          return (
            <div key={g.map((f) => f.id).join("+")} className="contents">
              {grouped ? (
                <div className="sticky left-0 z-10 flex border-b-2 border-b-slate-400 border-r border-slate-200 bg-slate-50">
                  <div className="flex w-2 shrink-0 flex-col">
                    {g.map((f) => (
                      <div key={f.id} className="flex-1" style={{ backgroundColor: f.color ?? "#64748b" }} />
                    ))}
                  </div>
                  <div className="px-3 py-3 space-y-1.5">
                    <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
                      {(FACILITY_SIZE_NOTES[first.name.toLowerCase()] ?? "").replace(/ /g, "")} haller
                    </div>
                    {g.map((f) => (
                      <div
                        key={f.id}
                        className="flex items-center gap-1.5 text-[13px] font-bold leading-tight"
                        style={{ color: shadeHex(f.color ?? "#64748b", 0.6) }}
                      >
                        <span className="inline-block h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: f.color ?? "#64748b" }} />
                        {f.name}
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div
                  className="sticky left-0 z-10 border-b-2 border-b-slate-400 border-r border-slate-200 px-3 py-3"
                  style={{ backgroundColor: hexToRgba(color, 0.14), borderLeft: `8px solid ${color}` }}
                >
                  <div className="text-sm font-bold leading-tight" style={{ color: shadeHex(color, 0.6) }}>
                    {nm.main}
                  </div>
                  {nm.sub && <div className="text-[11px] text-slate-500">{nm.sub}</div>}
                  {FACILITY_SIZE_NOTES[first.name.toLowerCase()] && (
                    <div className="text-[11px] text-slate-500">{FACILITY_SIZE_NOTES[first.name.toLowerCase()]}</div>
                  )}
                  {first.parentId && !nm.sub && !FACILITY_SIZE_NOTES[first.name.toLowerCase()] && (
                    <div className="text-[11px] text-slate-400">underfacilitet</div>
                  )}
                </div>
              )}
              {/* Klokkeslæt */}
              <div
                className="sticky left-[10rem] z-10 relative border-b-2 border-b-slate-400 border-r border-slate-200 bg-white"
                style={{ height: gridH + tagH }}
              >
                {hourMarks.map((m) => (
                  <div
                    key={m}
                    className="absolute right-1 -translate-y-1/2 text-[10.5px] text-slate-400 tabular-nums"
                    style={{ top: tagH + (m - gridStartMin) * WEEK_PX_PER_MIN }}
                  >
                    {String(Math.floor(m / 60) % 24).padStart(2, "0")}
                  </div>
                ))}
              </div>
              {dayStrs.map((dayStr, i) => (
                <div
                  key={`${g[0].id}|${dayStr}`}
                  className={`flex flex-col border-b-2 border-b-slate-400 ${i < 6 ? "border-r-2 border-r-slate-400" : ""}`}
                >
                  {grouped && (
                    <div className="flex bg-white/60" style={{ height: tagH }}>
                      {g.map((f, idx) => (
                        <div
                          key={f.id}
                          className={`flex-1 min-w-0 truncate px-1 text-[9.5px] font-bold uppercase tracking-wide leading-[20px] ${
                            idx > 0 ? "border-l border-dashed border-slate-400/60" : ""
                          }`}
                          style={{ color: shadeHex(f.color ?? "#64748b", 0.65), backgroundColor: hexToRgba(f.color ?? "#64748b", 0.12) }}
                        >
                          {f.name.replace(/s?hallen$/i, "")}
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="flex">{g.map((f, idx) => renderCell(f, dayStr, i, grouped, idx))}</div>
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Konflikt-boks ved træk/slip i dagsplanen - samme to valg (Dobbeltbook /
 * Aflys den oprindelige booking) som konflikt-boksen ved almindelig
 * oprettelse/redigering af en booking, blot som en fritstående boks (ikke en
 * del af BookingFormModal), da flytningen sker direkte fra kalenderen uden
 * at åbne en formular.
 */
function DragConflictBox({
  bookingTitle,
  conflicts,
  busy,
  onDoubleBook,
  onCancelOriginal,
  onDismiss,
}: {
  bookingTitle: string;
  conflicts: BookingDTO[];
  busy: boolean;
  onDoubleBook: () => void;
  onCancelOriginal: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-xl p-5 space-y-3">
        <div className="font-semibold text-slate-900">Flyt &quot;{bookingTitle}&quot;</div>
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 space-y-2">
          <div className="font-medium text-red-800 text-sm">Der er en konflikt med eksisterende booking(er):</div>
          {conflicts.map((c) => (
            <div key={c.id} className="text-sm text-red-700">
              {c.title} - {formatDaDate(c.startsAt)} {formatDaTime(c.startsAt)}-{formatDaTime(c.endsAt)}
            </div>
          ))}
          <div className="flex gap-1.5 mt-1">
            <button
              onClick={onDoubleBook}
              disabled={busy}
              className="flex-1 rounded-lg bg-red-600 text-white text-xs font-medium py-1.5 hover:bg-red-700 disabled:opacity-50"
            >
              {busy ? "Gemmer..." : "Dobbeltbook"}
            </button>
            <button
              onClick={onCancelOriginal}
              disabled={busy}
              className="flex-1 rounded-lg bg-slate-700 text-white text-xs font-medium py-1.5 hover:bg-slate-800 disabled:opacity-50"
            >
              {busy ? "Gemmer..." : "Aflys den oprindelige booking"}
            </button>
          </div>
        </div>
        <button onClick={onDismiss} className="w-full text-center text-xs text-slate-400 hover:text-slate-600 py-1">
          Fortryd flytningen
        </button>
      </div>
    </div>
  );
}

/**
 * Spørger om en flytning af en sæsonbooking skal gælde kun den ene
 * forekomst der blev trukket/redigeret, eller hele resten af sæsonen
 * (Martin bad eksplicit om dette valg i stedet for at vi bare gættede).
 */
function SeasonMoveChoiceBox({
  bookingTitle,
  onSingleBooking,
  onWholeSeason,
  onCancel,
}: {
  bookingTitle: string;
  onSingleBooking: () => void;
  onWholeSeason: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-xl p-5 space-y-3">
        <div className="font-semibold text-slate-900">Flyt &quot;{bookingTitle}&quot;</div>
        <div className="text-sm text-slate-600">
          Dette er en sæsonbooking. Skal flytningen kun gælde denne ene forekomst, eller hele resten af sæsonen?
        </div>
        <div className="flex flex-col gap-1.5">
          <button
            onClick={onWholeSeason}
            className="w-full rounded-lg bg-blue-600 text-white text-sm font-medium py-2 hover:bg-blue-700"
          >
            Flyt hele sæsonen (resten af den)
          </button>
          <button
            onClick={onSingleBooking}
            className="w-full rounded-lg border border-slate-300 text-slate-700 text-sm font-medium py-2 hover:bg-slate-50"
          >
            Flyt kun denne booking
          </button>
        </div>
        <button onClick={onCancel} className="w-full text-center text-xs text-slate-400 hover:text-slate-600 py-1">
          Fortryd flytningen
        </button>
      </div>
    </div>
  );
}

/**
 * Samme to-valgsboks som DragConflictBox, men for en flytning af en HEL
 * sæson - her kan flere forekomster (på forskellige datoer) konflikte
 * samtidig, så konflikterne vises grupperet pr. dato.
 */
function SeasonDragConflictBox({
  bookingTitle,
  conflictsByDate,
  busy,
  onDoubleBook,
  onCancelOriginal,
  onDismiss,
}: {
  bookingTitle: string;
  conflictsByDate: Record<string, BookingDTO[]>;
  busy: boolean;
  onDoubleBook: () => void;
  onCancelOriginal: () => void;
  onDismiss: () => void;
}) {
  const dates = Object.keys(conflictsByDate).sort();
  const occurrenceCount = dates.length;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-xl p-5 space-y-3">
        <div className="font-semibold text-slate-900">Flyt hele sæsonen &quot;{bookingTitle}&quot;</div>
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 space-y-2 max-h-72 overflow-y-auto">
          <div className="font-medium text-red-800 text-sm">
            {occurrenceCount} af forekomsterne konflikter med eksisterende booking(er):
          </div>
          {dates.map((date) => (
            <div key={date} className="space-y-1">
              <div className="text-xs font-medium text-red-700">{formatDaDate(`${date}T00:00:00`)}</div>
              {conflictsByDate[date].map((c) => (
                <div key={c.id} className="text-sm text-red-700 pl-2">
                  {c.title} - {formatDaTime(c.startsAt)}-{formatDaTime(c.endsAt)}
                </div>
              ))}
            </div>
          ))}
          <div className="flex gap-1.5 mt-1">
            <button
              onClick={onDoubleBook}
              disabled={busy}
              className="flex-1 rounded-lg bg-red-600 text-white text-xs font-medium py-1.5 hover:bg-red-700 disabled:opacity-50"
            >
              {busy ? "Gemmer..." : "Dobbeltbook"}
            </button>
            <button
              onClick={onCancelOriginal}
              disabled={busy}
              className="flex-1 rounded-lg bg-slate-700 text-white text-xs font-medium py-1.5 hover:bg-slate-800 disabled:opacity-50"
            >
              {busy ? "Gemmer..." : "Aflys de oprindelige bookinger"}
            </button>
          </div>
        </div>
        <button onClick={onDismiss} className="w-full text-center text-xs text-slate-400 hover:text-slate-600 py-1">
          Fortryd flytningen
        </button>
      </div>
    </div>
  );
}

function buildOrganizerMailtoLink(booking: BookingDTO, facilityName: string): string {
  const name = booking.contactName || "arrangør";
  const dato = formatDaDate(booking.startsAt);
  const tid = `${formatDaTime(booking.startsAt)}-${formatDaTime(booking.endsAt)}`;
  const subject = `Vedr. din booking af ${facilityName} den ${dato}`;
  const body = `Kære ${name}\n\nVedr. din booking af ${facilityName} den ${dato} kl. ${tid}.\n\n`;
  return `mailto:${encodeURIComponent(booking.contactEmail || "")}?subject=${encodeURIComponent(
    subject
  )}&body=${encodeURIComponent(body)}`;
}

function BookingDetail({
  booking,
  facilities,
  organizations,
  facilityName,
  onClose,
  onChanged,
}: {
  booking: BookingDTO;
  facilities: FacilityDTO[];
  organizations: OrganizationDTO[];
  facilityName: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [seasonBusy, setSeasonBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [toggleBusy, setToggleBusy] = useState(false);
  const isSeason = !!booking.seasonGroupId;

  /** Sætter/fjerner VIGTIG/KAMP direkte fra detaljevisningen, uden at åbne redigeringsformularen. */
  async function toggleImportant() {
    setToggleBusy(true);
    await fetch(`/api/bookings/${booking.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ important: !booking.important }),
    });
    setToggleBusy(false);
    onChanged();
  }

  async function cancelBooking() {
    const reason = window.prompt("Årsag (vises på aflysningslisten på hjemmesiden - kan stå tom):", "");
    if (reason === null) return;
    setBusy(true);
    await fetch(`/api/bookings/${booking.id}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason }),
    });
    setBusy(false);
    onChanged();
  }

  /** "Slet stille": ingen aflysningsliste på hjemmesiden og ingen mail. */
  async function silentDelete(wholeSeason: boolean) {
    const what = wholeSeason ? `HELE sæsonen "${booking.title}"` : isSeason ? `denne dags forekomst af "${booking.title}"` : `"${booking.title}"`;
    if (!window.confirm(`Slet ${what} STILLE?\n\nDen kommer IKKE på aflysningslisten på hjemmesiden, og der sendes ingen mail.`)) return;
    setBusy(true);
    await fetch(wholeSeason ? `/api/bookings/season/${booking.seasonGroupId}` : `/api/bookings/${booking.id}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ silent: true }),
    });
    setBusy(false);
    onChanged();
  }

  /** Aflyser alle KOMMENDE forekomster af sæsonen på én gang (se /api/bookings/season/[seasonGroupId]) - ikke kun den her viste dag. */
  async function cancelSeason() {
    const reason = window.prompt("Årsag (vises på aflysningslisten på hjemmesiden - kan stå tom):", "");
    if (reason === null) return;
    setSeasonBusy(true);
    await fetch(`/api/bookings/season/${booking.seasonGroupId}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason }),
    });
    setSeasonBusy(false);
    onChanged();
  }

  if (editing) {
    return (
      <BookingFormModal
        booking={booking}
        facilities={facilities}
        organizations={organizations}
        onClose={() => setEditing(false)}
        onSaved={onChanged}
      />
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-slate-900/40 p-0 md:p-4">
      <div className="w-full md:max-w-md bg-white rounded-t-2xl md:rounded-2xl shadow-xl">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <h3 className="font-semibold text-slate-900">{booking.title}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 text-xl leading-none">
            &times;
          </button>
        </div>
        <div className="p-5 space-y-3 text-sm">
          <div className="flex justify-between">
            <span className="text-slate-500">Facilitet</span>
            <span className="font-medium text-slate-800">{facilityName}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">Tidspunkt</span>
            <span className="font-medium text-slate-800">
              {formatDaDate(booking.startsAt)}, {formatDaTime(booking.startsAt)}-{formatDaTime(booking.endsAt)}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">Status</span>
            <span className={`text-xs px-2 py-0.5 rounded-full border ${BOOKING_STATUS_CLASSES[booking.status]}`}>
              {BOOKING_STATUS_LABELS[booking.status]}
            </span>
          </div>
          {booking.important && (
            <div className="flex justify-between">
              <span className="text-slate-500">Type</span>
              <span className={`text-xs px-2 py-0.5 rounded-full border ${IMPORTANT_BADGE_CLASSES}`}>{IMPORTANT_BADGE_LABEL}</span>
            </div>
          )}
          {isSeason && (
            <div className="flex justify-between">
              <span className="text-slate-500">Type</span>
              <span className={`text-xs px-2 py-0.5 rounded-full border ${SEASON_BADGE_CLASSES}`}>
                {SEASON_BADGE_LABEL}
                {booking.recurrenceRule &&
                  ` - hver ${weekdayName(booking.recurrenceRule.weekday).toLowerCase()} til og med ${formatDaDate(
                    `${booking.recurrenceRule.until}T00:00:00`
                  )}`}
              </span>
            </div>
          )}
          {booking.contactName && (
            <div className="flex justify-between">
              <span className="text-slate-500">Kontakt</span>
              <span className="font-medium text-slate-800">{booking.contactName}</span>
            </div>
          )}
          {booking.contactEmail && (
            <div className="flex justify-between">
              <span className="text-slate-500">E-mail</span>
              <span className="font-medium text-slate-800">{booking.contactEmail}</span>
            </div>
          )}
          {booking.lightLevel && booking.lightLevel !== 400 && (
            <div className="flex justify-between">
              <span className="text-slate-500">Lys i hallen</span>
              <span className="font-semibold text-amber-700">💡 {booking.lightLevel} lux</span>
            </div>
          )}
          {booking.accessCode && (
            <div className="flex justify-between">
              <span className="text-slate-500">Dørkode</span>
              <span className="font-mono font-semibold text-slate-800">{booking.accessCode}</span>
            </div>
          )}
          {booking.notes && (
            <div>
              <span className="text-slate-500 block mb-1">Noter</span>
              <p className="text-slate-700">{booking.notes}</p>
            </div>
          )}
        </div>
        {booking.status !== "aflyst" && (
          <div className="px-5 py-4 border-t border-slate-100 space-y-2">
            {booking.contactEmail && (
              <a
                href={buildOrganizerMailtoLink(booking, facilityName)}
                className="block w-full text-center rounded-lg border border-blue-200 text-blue-700 py-2.5 text-sm font-medium hover:bg-blue-50"
              >
                Send mail til arrangør
              </a>
            )}
            <div className="flex gap-3">
              <button
                onClick={() => setEditing(true)}
                className="flex-1 rounded-lg border border-slate-300 text-slate-700 py-2.5 text-sm font-medium hover:bg-slate-50"
              >
                Rediger
              </button>
              <button
                onClick={cancelBooking}
                disabled={busy}
                className="flex-1 rounded-lg border border-red-200 text-red-600 py-2.5 text-sm font-medium hover:bg-red-50 disabled:opacity-50"
              >
                {busy ? "Aflyser..." : isSeason ? "Aflys kun denne dag" : "Aflys booking"}
              </button>
            </div>
            <button
              onClick={toggleImportant}
              disabled={toggleBusy}
              className={`w-full rounded-lg border py-2.5 text-sm font-medium disabled:opacity-50 ${
                booking.important
                  ? "border-orange-300 bg-orange-50 text-orange-700 hover:bg-orange-100"
                  : "border-slate-300 text-slate-700 hover:bg-slate-50"
              }`}
            >
              {toggleBusy ? "Opdaterer..." : booking.important ? "Fjern VIGTIG/KAMP-markering" : "⚑ Markér som VIGTIG/KAMP"}
            </button>
            {isSeason && (
              <button
                onClick={cancelSeason}
                disabled={seasonBusy}
                className="w-full rounded-lg bg-red-600 text-white py-2.5 text-sm font-medium hover:bg-red-700 disabled:opacity-50"
              >
                {seasonBusy ? "Aflyser hele sæsonen..." : "Aflys hele sæsonen (alle kommende forekomster)"}
              </button>
            )}
            <div className="pt-2 mt-1 border-t border-slate-100 flex gap-3">
              <button
                onClick={() => silentDelete(false)}
                disabled={busy}
                title="Fjerner bookingen uden at den kommer på aflysningslisten på hjemmesiden og uden mail"
                className="flex-1 rounded-lg border border-slate-200 text-slate-500 py-2 text-xs font-medium hover:bg-slate-50 disabled:opacity-50"
              >
                🔇 {isSeason ? "Slet kun denne dag stille" : "Slet stille (ingen aflysningsliste/mail)"}
              </button>
              {isSeason && (
                <button
                  onClick={() => silentDelete(true)}
                  disabled={busy}
                  className="flex-1 rounded-lg border border-slate-200 text-slate-500 py-2 text-xs font-medium hover:bg-slate-50 disabled:opacity-50"
                >
                  🔇 Slet hele sæsonen stille
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
