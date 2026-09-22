"use client";

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
  SEASON_ACCENT_CLASS,
  SEASON_BADGE_CLASSES,
  SEASON_BADGE_LABEL,
  weekdayName,
} from "@/lib/statusLabels";
import { formatDaDate, formatDaTime } from "@/lib/ai/messages";
import { localISODate, nowLocalDateTimeString, roundDateTimeLocalString } from "@/lib/date";
import { BookingFormModal } from "./BookingFormModal";
import { DayNoteModal } from "./DayNoteModal";

type ViewMode = "liste" | "uge" | "facilitet" | "maaned" | "dag";

function startOfWeek(d: Date): Date {
  const date = new Date(d);
  const day = (date.getDay() + 6) % 7; // mandag = 0
  date.setDate(date.getDate() - day);
  date.setHours(0, 0, 0, 0);
  return date;
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
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

/** Bygger en naiv dato-tid-streng for `dateStr` ("YYYY-MM-DD") + `minutes` minutter siden midnat. */
function minutesToNaiveDateTimeString(dateStr: string, minutes: number): string {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setMinutes(d.getMinutes() + minutes);
  return toNaiveDateTimeString(d);
}

function clampMinutes(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

const WEEKDAY_SHORT = ["Man", "Tir", "Ons", "Tor", "Fre", "Lør", "Søn"];

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
  const [view, setView] = useState<ViewMode>("uge");
  const [anchor, setAnchor] = useState(new Date());
  // Standardvalgte faciliteter: Martin har oplyst at Opvisningshallen,
  // Træningshallen og Multisalen stort set altid er dem der bruges, så de er
  // markeret som standard i stedet for samtlige faciliteter. Falder tilbage
  // til alle faciliteter, hvis ingen af de tre findes (fx i et testmiljø med
  // andre navne), så filteret aldrig utilsigtet viser en tom kalender.
  const DEFAULT_FACILITY_NAMES = ["Opvisningshallen", "Træningshallen", "Multisalen"];
  const [selectedFacilityIds, setSelectedFacilityIds] = useState<Set<string>>(() => {
    const defaults = initialFacilities.filter((f) => DEFAULT_FACILITY_NAMES.includes(f.name));
    return new Set((defaults.length > 0 ? defaults : initialFacilities).map((f) => f.id));
  });
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

  const rangeStart = useMemo(() => {
    // "facilitet"-visningen (flere faciliteter side om side for ugen, jf.
    // GIBBS' ressourcekalender) bruger samme uge-interval som "uge".
    if (view === "uge" || view === "facilitet") return startOfWeek(anchor);
    if (view === "maaned") return startOfMonth(anchor);
    if (view === "dag") {
      const d = new Date(anchor);
      d.setHours(0, 0, 0, 0);
      return d;
    }
    return addDays(new Date(), -1);
  }, [view, anchor]);

  const rangeEnd = useMemo(() => {
    if (view === "uge" || view === "facilitet") return addDays(startOfWeek(anchor), 7);
    if (view === "maaned") {
      const start = startOfMonth(anchor);
      return new Date(start.getFullYear(), start.getMonth() + 1, 1);
    }
    if (view === "dag") {
      const d = new Date(anchor);
      d.setHours(0, 0, 0, 0);
      return addDays(d, 1);
    }
    return addDays(new Date(), 30);
  }, [view, anchor]);

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

  const visibleBookings = bookings
    .filter((b) => selectedFacilityIds.has(b.facilityId))
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
   * nærmeste 10 minutter) - blot som et fornuftigt udgangspunkt, det
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

  function facilityColor(id: string) {
    return facilities.find((f) => f.id === id)?.color ?? "#64748b";
  }

  function organizationName(id: string | null) {
    if (!id) return undefined;
    return organizations.find((o) => o.id === id)?.name;
  }

  function toggleFacility(id: string) {
    setSelectedFacilityIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /** Åbner højreklik-hurtigmenuen for en booking på musens position. */
  function openContextMenu(e: ReactMouseEvent, booking: BookingDTO) {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, booking });
  }

  async function quickCancelBooking(booking: BookingDTO) {
    const label = booking.seasonGroupId ? "denne dags forekomst af" : "";
    if (!window.confirm(`Aflys ${label} "${booking.title}"?`.replace("  ", " "))) return;
    setContextMenu(null);
    await fetch(`/api/bookings/${booking.id}`, { method: "DELETE" });
    loadBookings();
  }

  async function quickCancelSeason(booking: BookingDTO) {
    if (!booking.seasonGroupId) return;
    if (!window.confirm(`Aflys HELE sæsonen "${booking.title}" (alle kommende forekomster)?`)) return;
    setContextMenu(null);
    await fetch(`/api/bookings/season/${booking.seasonGroupId}`, { method: "DELETE" });
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
   * Fælles gem-funktion for både træk/slip i dagsplanen og "Flyt til i
   * morgen/i går" i hurtigmenuen: PATCH'er kun de(t) felt(er) der ændres
   * (facilitet og/eller tidspunkt) - PATCH-endpointet opdaterer kun de
   * medsendte felter og sender selv en flytningsmail (samme som ved
   * almindelig redigering). Ved konflikt (409) vises samme to-valgsboks som
   * alle andre steder i systemet (Martin), i stedet for enten at blokere
   * stille eller dobbeltbooke uden varsel.
   */
  async function applyBookingChange(
    booking: BookingDTO,
    pending: { facilityId: string; startsAt: string; endsAt: string },
    force: boolean
  ) {
    setDragBusy(true);
    const res = await fetch(`/api/bookings/${booking.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...pending, force }),
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

  async function resolveDragDoubleBook() {
    if (!dragConflict) return;
    await applyBookingChange(dragConflict.booking, dragConflict.pending, true);
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
    await applyBookingChange(booking, pending, true);
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

  return (
    <div className="flex flex-col md:flex-row gap-0 md:gap-6 p-4 md:p-8">
      {/* Filter sidebar */}
      <div className="md:w-56 shrink-0 mb-4 md:mb-0">
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="text-xs font-semibold uppercase text-slate-400 mb-2">Vis faciliteter</div>
          <div className="space-y-1.5 max-h-72 overflow-y-auto">
            {facilities
              .filter((f) => !f.archived)
              .map((f) => (
                <label key={f.id} className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedFacilityIds.has(f.id)}
                    onChange={() => toggleFacility(f.id)}
                    className="rounded border-slate-300"
                  />
                  <span
                    className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: f.color ?? "#64748b" }}
                  />
                  <span className={f.parentId ? "pl-2" : ""}>{f.name}</span>
                </label>
              ))}
          </div>
        </div>
      </div>

      {/* Main calendar area */}
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-2">
            <div className="inline-flex rounded-lg border border-slate-200 bg-white p-1">
              {(["liste", "uge", "facilitet", "dag", "maaned"] as ViewMode[]).map((v) => (
                <button
                  key={v}
                  onClick={() => setView(v)}
                  className={`px-3 py-1.5 text-sm font-medium rounded-md capitalize ${
                    view === v ? "bg-blue-600 text-white" : "text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  {v === "maaned" ? "Måned" : v === "facilitet" ? "Faciliteter" : v === "dag" ? "Dagsplan" : v}
                </button>
              ))}
            </div>
            {view !== "liste" && (
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setAnchor((a) => addDays(a, view === "maaned" ? -30 : view === "dag" ? -1 : -7))}
                  data-day-shift={view === "dag" ? "-1" : undefined}
                  title={view === "dag" ? "Forrige dag - træk en booking herhen for at flytte den en dag tilbage" : undefined}
                  className={`w-8 h-8 rounded-lg border text-slate-600 hover:bg-slate-50 transition-colors ${
                    view === "dag" && dayDragActive ? "border-blue-400 bg-blue-50 ring-2 ring-blue-300" : "border-slate-200 bg-white"
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
                  onClick={() => setAnchor((a) => addDays(a, view === "maaned" ? 30 : view === "dag" ? 1 : 7))}
                  data-day-shift={view === "dag" ? "1" : undefined}
                  title={view === "dag" ? "Næste dag - træk en booking herhen for at flytte den en dag frem" : undefined}
                  className={`w-8 h-8 rounded-lg border text-slate-600 hover:bg-slate-50 transition-colors ${
                    view === "dag" && dayDragActive ? "border-blue-400 bg-blue-50 ring-2 ring-blue-300" : "border-slate-200 bg-white"
                  }`}
                >
                  &rarr;
                </button>
              </div>
            )}
          </div>
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

        {loading && <div className="text-sm text-slate-400 mb-2">Indlæser...</div>}

        <div className="text-xs text-slate-400 mb-3">
          {SEASON_BADGE_LABEL} markerer sæsonbookinger (gentages ugentligt) - så en booking, der afviger fra den
          faste sæson, er nem at få øje på. Dobbeltklik en dag for at oprette en booking den dag. Hold musen over en
          booking for flere oplysninger, eller højreklik for hurtige handlinger.
        </div>

        {view === "liste" && (
          <ListView
            bookings={visibleBookings}
            facilityName={facilityName}
            facilityColor={facilityColor}
            organizationName={organizationName}
            onSelect={setSelectedBooking}
            onContextMenu={openContextMenu}
          />
        )}
        {view === "uge" && (
          <WeekView
            weekStart={rangeStart}
            bookings={visibleBookings}
            facilityName={facilityName}
            facilityColor={facilityColor}
            organizationName={organizationName}
            onSelect={setSelectedBooking}
            onContextMenu={openContextMenu}
            notesForDay={notesForDay}
            onAddNote={(dateStr) => setNoteModal({ date: dateStr })}
            onEditNote={(note) => setNoteModal({ date: note.date, note })}
            onDayDoubleClick={openNewBookingFor}
          />
        )}
        {view === "facilitet" && (
          <FacilityWeekView
            weekStart={rangeStart}
            facilities={facilities.filter((f) => !f.archived && selectedFacilityIds.has(f.id))}
            bookings={visibleBookings}
            organizationName={organizationName}
            onSelect={setSelectedBooking}
            onContextMenu={openContextMenu}
            onDayDoubleClick={openNewBookingFor}
          />
        )}
        {view === "dag" && (
          <DayGridView
            day={rangeStart}
            facilities={facilities.filter((f) => !f.archived && selectedFacilityIds.has(f.id))}
            bookings={visibleBookings}
            organizationName={organizationName}
            onSelect={setSelectedBooking}
            onContextMenu={openContextMenu}
            onDayDoubleClick={openNewBookingFor}
            onCommit={(booking, pending) => applyBookingChange(booking, pending, false)}
            onDragActiveChange={setDayDragActive}
          />
        )}
        {view === "maaned" && (
          <MonthView
            monthStart={rangeStart}
            bookings={visibleBookings}
            facilityName={facilityName}
            facilityColor={facilityColor}
            organizationName={organizationName}
            onSelect={setSelectedBooking}
            onContextMenu={openContextMenu}
            notesForDay={notesForDay}
            onAddNote={(dateStr) => setNoteModal({ date: dateStr })}
            onEditNote={(note) => setNoteModal({ date: note.date, note })}
            onDayDoubleClick={openNewBookingFor}
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
          onCancelDay={() => quickCancelBooking(contextMenu.booking)}
          onCancelSeason={() => quickCancelSeason(contextMenu.booking)}
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
  onCancelDay,
  onCancelSeason,
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
  onCancelDay: () => void;
  onCancelSeason: () => void;
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
  const maxTop = typeof window !== "undefined" ? window.innerHeight - 260 : y;
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
        </>
      )}
    </div>
  );
}

function BookingCard({
  booking,
  facilityName,
  facilityColor,
  organizationNameStr,
  onSelect,
  onContextMenu,
  compact,
}: {
  booking: BookingDTO;
  facilityName: string;
  facilityColor?: string;
  organizationNameStr?: string;
  onSelect: (b: BookingDTO) => void;
  onContextMenu?: (e: ReactMouseEvent, b: BookingDTO) => void;
  compact?: boolean;
}) {
  const isSeason = !!booking.seasonGroupId;
  return (
    <button
      onClick={() => onSelect(booking)}
      // Forhindrer at et dobbeltklik på et booking-kort bobler op til
      // dagscellen og fejlagtigt åbner "Ny booking" for dagen ovenpå.
      onDoubleClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => onContextMenu?.(e, booking)}
      title={bookingTooltip(booking, facilityName, organizationNameStr)}
      className={`w-full text-left rounded-lg border px-2.5 py-1.5 text-xs hover:shadow-sm transition-shadow ${
        BOOKING_STATUS_CLASSES[booking.status] ?? "bg-slate-100 border-slate-300"
      } ${isSeason ? SEASON_ACCENT_CLASS : ""}`}
      style={facilityCardStyle(facilityColor, booking.status)}
    >
      <div className="font-medium truncate">
        {isSeason && (
          <span title="Sæsonbooking - gentages ugentligt" className="mr-1">
            ↻
          </span>
        )}
        {booking.title}
      </div>
      {!compact && <div className="opacity-75">{facilityName}</div>}
      <div className="opacity-75">
        {formatDaTime(booking.startsAt)}-{formatDaTime(booking.endsAt)}
      </div>
    </button>
  );
}

function ListView({
  bookings,
  facilityName,
  facilityColor,
  organizationName,
  onSelect,
  onContextMenu,
}: {
  bookings: BookingDTO[];
  facilityName: (id: string) => string;
  facilityColor: (id: string) => string;
  organizationName: (id: string | null) => string | undefined;
  onSelect: (b: BookingDTO) => void;
  onContextMenu: (e: ReactMouseEvent, b: BookingDTO) => void;
}) {
  const byDay = new Map<string, BookingDTO[]>();
  for (const b of bookings) {
    const day = b.startsAt.slice(0, 10);
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day)!.push(b);
  }
  const days = [...byDay.keys()].sort();

  if (days.length === 0) {
    return <div className="rounded-2xl border border-dashed border-slate-200 p-10 text-center text-slate-400">Ingen bookinger i perioden.</div>;
  }

  return (
    <div className="space-y-4">
      {days.map((day) => (
        <div key={day} className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
          <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-100 font-medium text-sm text-slate-700 capitalize">
            {formatDaDate(day + "T00:00:00")}
          </div>
          <div className="divide-y divide-slate-100">
            {byDay.get(day)!.map((b) => (
              <button
                key={b.id}
                onClick={() => onSelect(b)}
                onContextMenu={(e) => onContextMenu(e, b)}
                title={bookingTooltip(b, facilityName(b.facilityId), organizationName(b.organizationId))}
                className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-50 text-left border-l-[6px]"
                style={facilityCardStyle(facilityColor(b.facilityId), b.status)}
              >
                <div className="flex items-center gap-3">
                  <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: facilityColor(b.facilityId) }} />
                  <div>
                    <div className="font-medium text-slate-800 text-sm">
                      {b.seasonGroupId && (
                        <span title="Sæsonbooking - gentages ugentligt" className="mr-1">
                          ↻
                        </span>
                      )}
                      {b.title}
                    </div>
                    <div className="text-xs text-slate-500">{facilityName(b.facilityId)}</div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-medium text-slate-600">
                    {formatDaTime(b.startsAt)}-{formatDaTime(b.endsAt)}
                  </div>
                  <div className="flex items-center justify-end gap-1 mt-0.5">
                    <span className={`inline-block text-[11px] px-1.5 py-0.5 rounded-full border ${BOOKING_STATUS_CLASSES[b.status]}`}>
                      {BOOKING_STATUS_LABELS[b.status]}
                    </span>
                    {b.seasonGroupId && (
                      <span className={`inline-block text-[11px] px-1.5 py-0.5 rounded-full border ${SEASON_BADGE_CLASSES}`}>
                        {SEASON_BADGE_LABEL}
                      </span>
                    )}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function WeekView({
  weekStart,
  bookings,
  facilityName,
  facilityColor,
  organizationName,
  onSelect,
  onContextMenu,
  notesForDay,
  onAddNote,
  onEditNote,
  onDayDoubleClick,
}: {
  weekStart: Date;
  bookings: BookingDTO[];
  facilityName: (id: string) => string;
  facilityColor: (id: string) => string;
  organizationName: (id: string | null) => string | undefined;
  onSelect: (b: BookingDTO) => void;
  onContextMenu: (e: ReactMouseEvent, b: BookingDTO) => void;
  notesForDay: (dateStr: string) => DayNoteDTO[];
  onAddNote: (dateStr: string) => void;
  onEditNote: (note: DayNoteDTO) => void;
  onDayDoubleClick: (dateStr: string) => void;
}) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  return (
    <div className="grid grid-cols-1 md:grid-cols-7 gap-3">
      {days.map((d, i) => {
        const dayStr = localISODate(d);
        const dayBookings = bookings
          .filter((b) => b.startsAt.slice(0, 10) === dayStr)
          .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
        const isToday = dayStr === localISODate();
        return (
          <div
            key={dayStr}
            onDoubleClick={() => onDayDoubleClick(dayStr)}
            title="Dobbeltklik for at oprette en booking denne dag"
            className="rounded-2xl border border-slate-200 bg-white overflow-hidden min-h-[140px] cursor-pointer"
          >
            <div
              className={`px-3 py-2 text-xs font-semibold border-b border-slate-100 flex items-center justify-between ${
                isToday ? "bg-blue-50 text-blue-700" : "text-slate-500"
              }`}
            >
              <span>
                {WEEKDAY_SHORT[i]} {d.getDate()}/{d.getMonth() + 1}
              </span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onAddNote(dayStr);
                }}
                title="Tilføj dagsnote"
                className="text-slate-400 hover:text-amber-600 leading-none px-1"
              >
                +note
              </button>
            </div>
            <DayNoteBadges notes={notesForDay(dayStr)} onEditNote={onEditNote} />
            <div className="p-2 space-y-1.5">
              {dayBookings.length === 0 && <div className="text-[11px] text-slate-300 px-1 py-2">Ledig</div>}
              {dayBookings.map((b) => (
                <BookingCard
                  key={b.id}
                  booking={b}
                  facilityName={facilityName(b.facilityId)}
                  facilityColor={facilityColor(b.facilityId)}
                  organizationNameStr={organizationName(b.organizationId)}
                  onSelect={onSelect}
                  onContextMenu={onContextMenu}
                  compact
                />
              ))}
            </div>
          </div>
        );
      })}
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

/**
 * Ressourcevisning: hver valgt facilitet får sin egen ugeblok med 7
 * dagskolonner ved siden af hinanden - så man fx kan sammenligne Multisalen,
 * Opvisningshallen og Træningshallen for samme uge på én gang, ligesom i
 * GIBBS' kalender. Hvilke faciliteter der vises styres af "Vis
 * faciliteter"-filteret i venstre side; man blader i ugerne med
 * pil-knapperne ved siden af visningsvælgeren.
 */
function FacilityWeekView({
  weekStart,
  facilities,
  bookings,
  organizationName,
  onSelect,
  onContextMenu,
  onDayDoubleClick,
}: {
  weekStart: Date;
  facilities: FacilityDTO[];
  bookings: BookingDTO[];
  organizationName: (id: string | null) => string | undefined;
  onSelect: (b: BookingDTO) => void;
  onContextMenu: (e: ReactMouseEvent, b: BookingDTO) => void;
  onDayDoubleClick: (dateStr: string, facilityId: string) => void;
}) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  if (facilities.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-200 p-10 text-center text-slate-400">
        Vælg mindst én facilitet i venstre side for at se ugeoversigten.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto pb-2">
      {/* Kolonnerne er fleksible (flex-1) i stedet for en fast bredde, så et
          lille antal valgte faciliteter (fx standardvalget på tre) deler
          hele den ledige bredde imellem sig og kan ses samtidig uden
          sidescroll. min-w-[260px] sikrer stadig læsbare dagsceller hvis
          mange faciliteter vælges på én gang - så falder man tilbage til
          vandret scroll (overflow-x-auto ovenfor), som før. Selve
          kolonneoverskriften er nu farvet i facilitetens egen farve (i
          stedet for kun en lille prik), så det er tydeligt hvilken hal man
          kigger på, når flere står ved siden af hinanden. */}
      <div className="flex gap-4 min-w-full align-top">
        {facilities.map((f) => (
          <div key={f.id} className="flex-1 min-w-[260px] max-w-[560px]">
            <div
              className="flex items-center gap-2 mb-2 px-2.5 py-1.5 rounded-lg"
              style={{ backgroundColor: hexToRgba(f.color ?? "#64748b", 0.16) }}
            >
              <span className="inline-block w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: f.color ?? "#64748b" }} />
              <div className="font-semibold text-sm text-slate-800 truncate">{f.name}</div>
            </div>
            <div className="grid grid-cols-7 gap-1.5">
              {days.map((d, i) => {
                const dayStr = localISODate(d);
                const dayBookings = bookings
                  .filter((b) => b.facilityId === f.id && b.startsAt.slice(0, 10) === dayStr)
                  .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
                const isToday = dayStr === localISODate();
                return (
                  <div
                    key={dayStr}
                    onDoubleClick={() => onDayDoubleClick(dayStr, f.id)}
                    title="Dobbeltklik for at oprette en booking af denne facilitet denne dag"
                    className={`rounded-xl border overflow-hidden min-h-[220px] cursor-pointer ${
                      isToday ? "border-blue-300 bg-blue-50/40" : "border-slate-200 bg-white"
                    }`}
                  >
                    <div
                      className={`px-1.5 py-1.5 text-[11px] font-semibold text-center border-b ${
                        isToday ? "text-blue-700 border-blue-200" : "text-slate-500 border-slate-100"
                      }`}
                    >
                      {WEEKDAY_SHORT[i]} {d.getDate()}/{d.getMonth() + 1}
                    </div>
                    <div className="p-1 space-y-1">
                      {dayBookings.length === 0 && <div className="text-[10px] text-slate-300 px-1 py-2 text-center">Ledig</div>}
                      {dayBookings.map((b) => (
                        <button
                          key={b.id}
                          onClick={() => onSelect(b)}
                          onDoubleClick={(e) => e.stopPropagation()}
                          onContextMenu={(e) => onContextMenu(e, b)}
                          title={bookingTooltip(b, f.name, organizationName(b.organizationId))}
                          className={`w-full text-left rounded-lg px-1.5 py-1 text-[10px] border hover:shadow-sm transition-shadow ${
                            BOOKING_STATUS_CLASSES[b.status] ?? "bg-slate-100 border-slate-300"
                          } ${b.seasonGroupId ? SEASON_ACCENT_CLASS : ""}`}
                          style={facilityCardStyle(f.color, b.status)}
                        >
                          <div className="font-medium truncate">
                            {b.seasonGroupId && <span className="mr-0.5">↻</span>}
                            {b.title}
                          </div>
                          <div className="opacity-75">
                            {formatDaTime(b.startsAt)}-{formatDaTime(b.endsAt)}
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
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
    (b) => b.startsAt.slice(0, 10) === dayStr && b.status !== "aflyst" && b.status !== "afvist"
  );

  // Tidsaksens grænser udvides automatisk, hvis en booking rækker udenfor
  // standardintervallet (06.00-24.00), så intet nogensinde beskæres.
  let gridStartMin = DAY_GRID_START_MIN;
  let gridEndMin = DAY_GRID_END_MIN;
  for (const b of dayBookings) {
    const s = minutesOfDay(parseNaiveDateTime(b.startsAt));
    const endDate = parseNaiveDateTime(b.endsAt);
    const e = endDate.toDateString() === day.toDateString() ? minutesOfDay(endDate) : 24 * 60;
    if (s < gridStartMin) gridStartMin = Math.floor(s / 60) * 60;
    if (e > gridEndMin) gridEndMin = Math.ceil(e / 60) * 60;
  }

  const totalMinutes = gridEndMin - gridStartMin;
  const gridHeight = totalMinutes * DAY_GRID_PX_PER_MIN;
  const hourMarks = Array.from({ length: totalMinutes / 60 + 1 }, (_, i) => gridStartMin + i * 60);

  function startDrag(e: ReactPointerEvent, booking: BookingDTO, mode: DayDragMode) {
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
        Vælg mindst én facilitet i venstre side for at se dagsplanen.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto pb-2 select-none">
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
                  const startMin = isDragged ? (drag as DayDragState).currentStartMin : minutesOfDay(parseNaiveDateTime(b.startsAt));
                  const endMin = isDragged ? (drag as DayDragState).currentEndMin : minutesOfDay(parseNaiveDateTime(b.endsAt));
                  const top = (startMin - gridStartMin) * DAY_GRID_PX_PER_MIN;
                  const height = Math.max(22, (endMin - startMin) * DAY_GRID_PX_PER_MIN);
                  return (
                    <div
                      key={b.id}
                      onPointerDown={(e) => startDrag(e, b, "move")}
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
                        ...facilityCardStyle(f.color, b.status),
                      }}
                      className={`rounded-lg border px-1.5 py-1 text-[10px] overflow-hidden cursor-grab active:cursor-grabbing shadow-sm ${
                        BOOKING_STATUS_CLASSES[b.status] ?? "bg-slate-100 border-slate-300"
                      } ${b.seasonGroupId ? SEASON_ACCENT_CLASS : ""} ${isDragged ? "opacity-90 ring-2 ring-blue-400" : ""}`}
                    >
                      <div
                        onPointerDown={(e) => startDrag(e, b, "resize-top")}
                        className="absolute top-0 left-0 right-0 h-2 cursor-ns-resize"
                        style={{ touchAction: "none" }}
                      />
                      <div className="font-medium truncate leading-tight">
                        {b.seasonGroupId && <span className="mr-0.5">↻</span>}
                        {b.title}
                      </div>
                      <div className="opacity-75 leading-tight">
                        {String(Math.floor(startMin / 60) % 24).padStart(2, "0")}.{String(startMin % 60).padStart(2, "0")}-
                        {String(Math.floor(endMin / 60) % 24).padStart(2, "0")}.{String(endMin % 60).padStart(2, "0")}
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
      <div className="text-xs text-slate-400 mt-2">
        Træk et kort for at flytte det til et andet tidspunkt eller en anden facilitet - eller hen over ←/→-knapperne
        for at flytte det til forrige/næste dag. Træk i kortets top- eller bundkant for at forlænge/afkorte det.
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

function MonthView({
  monthStart,
  bookings,
  facilityName,
  facilityColor,
  organizationName,
  onSelect,
  onContextMenu,
  notesForDay,
  onAddNote,
  onEditNote,
  onDayDoubleClick,
}: {
  monthStart: Date;
  bookings: BookingDTO[];
  facilityName: (id: string) => string;
  facilityColor: (id: string) => string;
  organizationName: (id: string | null) => string | undefined;
  onSelect: (b: BookingDTO) => void;
  onContextMenu: (e: ReactMouseEvent, b: BookingDTO) => void;
  notesForDay: (dateStr: string) => DayNoteDTO[];
  onAddNote: (dateStr: string) => void;
  onEditNote: (note: DayNoteDTO) => void;
  onDayDoubleClick: (dateStr: string) => void;
}) {
  const firstDayOffset = (monthStart.getDay() + 6) % 7;
  const daysInMonth = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0).getDate();
  const cells: (Date | null)[] = [
    ...Array.from({ length: firstDayOffset }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => new Date(monthStart.getFullYear(), monthStart.getMonth(), i + 1)),
  ];

  return (
    <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
      <div className="grid grid-cols-7 border-b border-slate-100">
        {WEEKDAY_SHORT.map((d) => (
          <div key={d} className="px-2 py-2 text-xs font-semibold text-slate-500 text-center">
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {cells.map((d, i) => {
          if (!d) return <div key={i} className="border-b border-r border-slate-100 min-h-[90px] bg-slate-50/50" />;
          const dayStr = localISODate(d);
          const dayBookings = bookings.filter((b) => b.startsAt.slice(0, 10) === dayStr);
          const notes = notesForDay(dayStr);
          const isToday = dayStr === localISODate();
          return (
            <div
              key={i}
              onDoubleClick={() => onDayDoubleClick(dayStr)}
              title="Dobbeltklik for at oprette en booking denne dag"
              className="border-b border-r border-slate-100 min-h-[90px] p-1.5 cursor-pointer"
            >
              <div className="flex items-center justify-between mb-1">
                <div className={`text-xs font-medium ${isToday ? "text-blue-600" : "text-slate-500"}`}>{d.getDate()}</div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onAddNote(dayStr);
                  }}
                  title="Tilføj dagsnote"
                  className="text-[10px] text-slate-300 hover:text-amber-600 leading-none"
                >
                  +note
                </button>
              </div>
              {notes.map((n) => (
                <button
                  key={n.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    onEditNote(n);
                  }}
                  className="w-full text-left truncate rounded bg-amber-50 border border-amber-200 px-1 py-0.5 text-[9px] text-amber-800 mb-0.5"
                  title={n.text}
                >
                  {n.text}
                </button>
              ))}
              <div className="space-y-1">
                {dayBookings.slice(0, 3).map((b) => (
                  <button
                    key={b.id}
                    onClick={() => onSelect(b)}
                    onDoubleClick={(e) => e.stopPropagation()}
                    onContextMenu={(e) => onContextMenu(e, b)}
                    title={bookingTooltip(b, facilityName(b.facilityId), organizationName(b.organizationId))}
                    className={`w-full text-left truncate rounded px-1 py-0.5 text-[10px] border ${BOOKING_STATUS_CLASSES[b.status]} ${
                      b.seasonGroupId ? SEASON_ACCENT_CLASS : ""
                    }`}
                    style={facilityCardStyle(facilityColor(b.facilityId), b.status)}
                  >
                    {b.seasonGroupId && "↻ "}
                    {b.title}
                  </button>
                ))}
                {dayBookings.length > 3 && <div className="text-[10px] text-slate-400 pl-1">+{dayBookings.length - 3} mere</div>}
              </div>
            </div>
          );
        })}
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
  const isSeason = !!booking.seasonGroupId;

  async function cancelBooking() {
    setBusy(true);
    await fetch(`/api/bookings/${booking.id}`, { method: "DELETE" });
    setBusy(false);
    onChanged();
  }

  /** Aflyser alle KOMMENDE forekomster af sæsonen på én gang (se /api/bookings/season/[seasonGroupId]) - ikke kun den her viste dag. */
  async function cancelSeason() {
    setSeasonBusy(true);
    await fetch(`/api/bookings/season/${booking.seasonGroupId}`, { method: "DELETE" });
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
            {isSeason && (
              <button
                onClick={cancelSeason}
                disabled={seasonBusy}
                className="w-full rounded-lg bg-red-600 text-white py-2.5 text-sm font-medium hover:bg-red-700 disabled:opacity-50"
              >
                {seasonBusy ? "Aflyser hele sæsonen..." : "Aflys hele sæsonen (alle kommende forekomster)"}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
