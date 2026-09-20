"use client";

import { useEffect, useMemo, useState } from "react";
import type { BookingDTO, FacilityDTO, OrganizationDTO } from "@/lib/clientTypes";
import { BOOKING_STATUS_CLASSES, BOOKING_STATUS_LABELS } from "@/lib/statusLabels";
import { formatDaDate, formatDaTime } from "@/lib/ai/messages";
import { localISODate, nowLocalDateTimeString } from "@/lib/date";
import { BookingFormModal } from "./BookingFormModal";

type ViewMode = "liste" | "uge" | "facilitet" | "maaned";

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

const WEEKDAY_SHORT = ["Man", "Tir", "Ons", "Tor", "Fre", "Lør", "Søn"];

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
  const [view, setView] = useState<ViewMode>("uge");
  const [anchor, setAnchor] = useState(new Date());
  const [selectedFacilityIds, setSelectedFacilityIds] = useState<Set<string>>(
    new Set(initialFacilities.map((f) => f.id))
  );
  const [showModal, setShowModal] = useState(false);
  const [selectedBooking, setSelectedBooking] = useState<BookingDTO | null>(null);
  const [loading, setLoading] = useState(false);

  const rangeStart = useMemo(() => {
    // "facilitet"-visningen (flere faciliteter side om side for ugen, jf.
    // GIBBS' ressourcekalender) bruger samme uge-interval som "uge".
    if (view === "uge" || view === "facilitet") return startOfWeek(anchor);
    if (view === "maaned") return startOfMonth(anchor);
    return addDays(new Date(), -1);
  }, [view, anchor]);

  const rangeEnd = useMemo(() => {
    if (view === "uge" || view === "facilitet") return addDays(startOfWeek(anchor), 7);
    if (view === "maaned") {
      const start = startOfMonth(anchor);
      return new Date(start.getFullYear(), start.getMonth() + 1, 1);
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

  useEffect(() => {
    loadBookings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, anchor]);

  const visibleBookings = bookings
    .filter((b) => selectedFacilityIds.has(b.facilityId))
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));

  function facilityName(id: string) {
    return facilities.find((f) => f.id === id)?.name ?? "Ukendt";
  }

  function facilityColor(id: string) {
    return facilities.find((f) => f.id === id)?.color ?? "#64748b";
  }

  function toggleFacility(id: string) {
    setSelectedFacilityIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
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
              {(["liste", "uge", "facilitet", "maaned"] as ViewMode[]).map((v) => (
                <button
                  key={v}
                  onClick={() => setView(v)}
                  className={`px-3 py-1.5 text-sm font-medium rounded-md capitalize ${
                    view === v ? "bg-blue-600 text-white" : "text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  {v === "maaned" ? "Måned" : v === "facilitet" ? "Faciliteter" : v}
                </button>
              ))}
            </div>
            {view !== "liste" && (
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setAnchor((a) => addDays(a, view === "maaned" ? -30 : -7))}
                  className="w-8 h-8 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
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
                  onClick={() => setAnchor((a) => addDays(a, view === "maaned" ? 30 : 7))}
                  className="w-8 h-8 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                >
                  &rarr;
                </button>
              </div>
            )}
          </div>
          <button
            onClick={() => {
              setSelectedBooking(null);
              setShowModal(true);
            }}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            + Ny booking
          </button>
        </div>

        {loading && <div className="text-sm text-slate-400 mb-2">Indlæser...</div>}

        {view === "liste" && (
          <ListView bookings={visibleBookings} facilityName={facilityName} facilityColor={facilityColor} onSelect={setSelectedBooking} />
        )}
        {view === "uge" && (
          <WeekView
            weekStart={rangeStart}
            bookings={visibleBookings}
            facilityName={facilityName}
            facilityColor={facilityColor}
            onSelect={setSelectedBooking}
          />
        )}
        {view === "facilitet" && (
          <FacilityWeekView
            weekStart={rangeStart}
            facilities={facilities.filter((f) => !f.archived && selectedFacilityIds.has(f.id))}
            bookings={visibleBookings}
            onSelect={setSelectedBooking}
          />
        )}
        {view === "maaned" && (
          <MonthView
            monthStart={rangeStart}
            bookings={visibleBookings}
            facilityName={facilityName}
            onSelect={setSelectedBooking}
          />
        )}
      </div>

      {showModal && (
        <BookingFormModal
          facilities={facilities}
          organizations={organizations}
          onClose={() => setShowModal(false)}
          onSaved={() => {
            setShowModal(false);
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
    </div>
  );
}

function BookingCard({
  booking,
  facilityName,
  facilityColor,
  onSelect,
  compact,
}: {
  booking: BookingDTO;
  facilityName: string;
  facilityColor?: string;
  onSelect: (b: BookingDTO) => void;
  compact?: boolean;
}) {
  return (
    <button
      onClick={() => onSelect(booking)}
      className={`w-full text-left rounded-lg border px-2.5 py-1.5 text-xs hover:shadow-sm transition-shadow ${
        BOOKING_STATUS_CLASSES[booking.status] ?? "bg-slate-100 border-slate-300"
      }`}
      style={facilityColor ? { borderLeftColor: facilityColor, borderLeftWidth: 3 } : undefined}
    >
      <div className="font-medium truncate">{booking.title}</div>
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
  onSelect,
}: {
  bookings: BookingDTO[];
  facilityName: (id: string) => string;
  facilityColor: (id: string) => string;
  onSelect: (b: BookingDTO) => void;
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
              <button key={b.id} onClick={() => onSelect(b)} className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-50 text-left">
                <div className="flex items-center gap-3">
                  <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: facilityColor(b.facilityId) }} />
                  <div>
                    <div className="font-medium text-slate-800 text-sm">{b.title}</div>
                    <div className="text-xs text-slate-500">{facilityName(b.facilityId)}</div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-medium text-slate-600">
                    {formatDaTime(b.startsAt)}-{formatDaTime(b.endsAt)}
                  </div>
                  <div className={`inline-block mt-0.5 text-[11px] px-1.5 py-0.5 rounded-full border ${BOOKING_STATUS_CLASSES[b.status]}`}>
                    {BOOKING_STATUS_LABELS[b.status]}
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
  onSelect,
}: {
  weekStart: Date;
  bookings: BookingDTO[];
  facilityName: (id: string) => string;
  facilityColor: (id: string) => string;
  onSelect: (b: BookingDTO) => void;
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
          <div key={dayStr} className="rounded-2xl border border-slate-200 bg-white overflow-hidden min-h-[140px]">
            <div className={`px-3 py-2 text-xs font-semibold border-b border-slate-100 ${isToday ? "bg-blue-50 text-blue-700" : "text-slate-500"}`}>
              {WEEKDAY_SHORT[i]} {d.getDate()}/{d.getMonth() + 1}
            </div>
            <div className="p-2 space-y-1.5">
              {dayBookings.length === 0 && <div className="text-[11px] text-slate-300 px-1 py-2">Ledig</div>}
              {dayBookings.map((b) => (
                <BookingCard key={b.id} booking={b} facilityName={facilityName(b.facilityId)} facilityColor={facilityColor(b.facilityId)} onSelect={onSelect} compact />
              ))}
            </div>
          </div>
        );
      })}
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
  onSelect,
}: {
  weekStart: Date;
  facilities: FacilityDTO[];
  bookings: BookingDTO[];
  onSelect: (b: BookingDTO) => void;
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
      <div className="inline-flex gap-4 min-w-full align-top">
        {facilities.map((f) => (
          <div key={f.id} className="w-[560px] shrink-0">
            <div className="flex items-center gap-2 mb-2 px-1">
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
                    className={`rounded-xl border overflow-hidden min-h-[220px] ${
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
                          className={`w-full text-left rounded-lg px-1.5 py-1 text-[10px] border hover:shadow-sm transition-shadow ${
                            BOOKING_STATUS_CLASSES[b.status] ?? "bg-slate-100 border-slate-300"
                          }`}
                        >
                          <div className="font-medium truncate">{b.title}</div>
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

function MonthView({
  monthStart,
  bookings,
  facilityName,
  onSelect,
}: {
  monthStart: Date;
  bookings: BookingDTO[];
  facilityName: (id: string) => string;
  onSelect: (b: BookingDTO) => void;
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
          const isToday = dayStr === localISODate();
          return (
            <div key={i} className="border-b border-r border-slate-100 min-h-[90px] p-1.5">
              <div className={`text-xs font-medium mb-1 ${isToday ? "text-blue-600" : "text-slate-500"}`}>{d.getDate()}</div>
              <div className="space-y-1">
                {dayBookings.slice(0, 3).map((b) => (
                  <button
                    key={b.id}
                    onClick={() => onSelect(b)}
                    className={`w-full text-left truncate rounded px-1 py-0.5 text-[10px] border ${BOOKING_STATUS_CLASSES[b.status]}`}
                    title={`${b.title} - ${facilityName(b.facilityId)}`}
                  >
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
  const [editing, setEditing] = useState(false);

  async function cancelBooking() {
    setBusy(true);
    await fetch(`/api/bookings/${booking.id}`, { method: "DELETE" });
    setBusy(false);
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
          <div className="px-5 py-4 border-t border-slate-100 flex gap-3">
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
              {busy ? "Aflyser..." : "Aflys booking"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
