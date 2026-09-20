"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { capitalizeDaDate, formatDaDateShort, formatDaTime } from "@/lib/ai/messages";
import { addDays, isoWeekNumber, localISODate, startOfWeek } from "@/lib/date";
import { BOOKING_STATUS_CLASSES, BOOKING_STATUS_LABELS } from "@/lib/statusLabels";
import { BookingFormModal } from "@/components/BookingFormModal";
import type { BookingDTO, FacilityDTO, OrganizationDTO } from "@/lib/clientTypes";

// /api/pedel/week returnerer en fuld booking-række (spredt) plus disse to
// ekstra felter - så WeekBooking kan bruges alle steder en BookingDTO kan.
interface WeekBooking extends BookingDTO {
  facilityName: string;
  organizationName?: string;
}

function formatShortDay(d: Date): string {
  return d.toLocaleDateString("da-DK", { day: "2-digit", month: "long" });
}

/** "20. - 26. oktober 2026" - årstal vises kun for slutdatoen, som i praksis altid er i samme kalenderår som startdatoen. */
function weekRangeLabel(weekStart: Date): string {
  const weekEnd = addDays(weekStart, 6);
  return `${formatShortDay(weekStart)} - ${formatShortDay(weekEnd)} ${weekEnd.getFullYear()}`;
}

export default function PedelPage() {
  const [weekStart, setWeekStart] = useState<Date>(() => startOfWeek(new Date()));
  const [bookings, setBookings] = useState<WeekBooking[]>([]);
  const [facilities, setFacilities] = useState<FacilityDTO[]>([]);
  const [organizations, setOrganizations] = useState<OrganizationDTO[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [editing, setEditing] = useState<WeekBooking | null>(null);
  const [loading, setLoading] = useState(true);

  const weekStartStr = localISODate(weekStart);
  const todayStr = localISODate();
  const isCurrentWeek = weekStartStr === localISODate(startOfWeek(new Date()));

  // Faciliteter/foreninger ændrer sig sjældent og skal ikke genhentes, hver
  // gang man blader en uge frem eller tilbage.
  useEffect(() => {
    Promise.all([
      fetch("/api/facilities").then((r) => r.json()),
      fetch("/api/organizations").then((r) => r.json()),
    ]).then(([f, o]) => {
      setFacilities(f);
      setOrganizations(o);
    });
  }, []);

  async function loadWeek() {
    setLoading(true);
    const data = await fetch(`/api/pedel/week?start=${weekStartStr}`).then((r) => r.json());
    setBookings(data.bookings);
    setLoading(false);
  }

  useEffect(() => {
    loadWeek();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekStartStr]);

  async function cancelBooking(id: string) {
    await fetch(`/api/bookings/${id}`, { method: "DELETE" });
    setExpanded(null);
    loadWeek();
  }

  // De 7 dage i den viste uge, hver med sine egne bookinger - bruges af
  // både skærmvisningen og udskriftsvisningen, så de to altid viser
  // præcis det samme program.
  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const date = addDays(weekStart, i);
    const dateStr = localISODate(date);
    return {
      dateStr,
      isToday: dateStr === todayStr,
      items: bookings.filter((b) => b.startsAt.slice(0, 10) === dateStr),
    };
  });

  return (
    <div className="min-h-screen bg-slate-50 print:bg-white">
      <div className="sticky top-0 z-10 bg-white border-b border-slate-200 px-4 py-4 print:hidden">
        <div className="flex items-center justify-between mb-3">
          <div className="text-xs text-slate-400">Pedelvisning</div>
          <div className="flex items-center gap-4">
            <button onClick={() => window.print()} className="text-xs text-blue-600 font-medium">
              Udskriv
            </button>
            <Link href="/" className="text-xs text-blue-600">
              Til administration
            </Link>
          </div>
        </div>
        <div className="flex items-center justify-between gap-3">
          <button
            onClick={() => setWeekStart((w) => addDays(w, -7))}
            aria-label="Forrige uge"
            className="w-9 h-9 shrink-0 rounded-full border border-slate-200 text-slate-500 flex items-center justify-center text-lg"
          >
            &larr;
          </button>
          <div className="text-center">
            <h1 className="text-lg font-semibold text-slate-900">Uge {isoWeekNumber(weekStart)}</h1>
            <div className="text-xs text-slate-500">{weekRangeLabel(weekStart)}</div>
          </div>
          <button
            onClick={() => setWeekStart((w) => addDays(w, 7))}
            aria-label="Næste uge"
            className="w-9 h-9 shrink-0 rounded-full border border-slate-200 text-slate-500 flex items-center justify-center text-lg"
          >
            &rarr;
          </button>
        </div>
        {!isCurrentWeek && (
          <div className="text-center mt-2">
            <button onClick={() => setWeekStart(startOfWeek(new Date()))} className="text-xs text-blue-600 font-medium">
              Til denne uge
            </button>
          </div>
        )}
      </div>

      {/* Skærmvisning: interaktive kort grupperet pr. dag, skjules ved udskrift */}
      <div className="p-4 space-y-5 pb-28 print:hidden">
        {loading && <div className="text-center text-slate-400 py-10">Indlæser...</div>}
        {!loading &&
          weekDays.map(({ dateStr, isToday, items }) => (
            <div key={dateStr}>
              <div className="flex items-center gap-2 mb-2 px-1">
                <h2 className={`text-sm font-semibold ${isToday ? "text-blue-700" : "text-slate-700"}`}>
                  {capitalizeDaDate(formatDaDateShort(`${dateStr}T00:00:00`))}
                </h2>
                {isToday && (
                  <span className="text-[10px] font-medium text-blue-700 bg-blue-100 px-1.5 py-0.5 rounded-full">
                    I dag
                  </span>
                )}
              </div>
              {items.length === 0 ? (
                <div className="text-sm text-slate-400 px-1">Ingen aktiviteter.</div>
              ) : (
                <div className="space-y-3">
                  {items.map((b) => {
                    const isOpen = expanded === b.id;
                    return (
                      <div key={b.id} className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
                        <button
                          onClick={() => setExpanded(isOpen ? null : b.id)}
                          className="w-full flex items-center justify-between px-4 py-4 text-left"
                        >
                          <div>
                            <div className="text-lg font-semibold text-slate-900">
                              {formatDaTime(b.startsAt)} - {formatDaTime(b.endsAt)}
                            </div>
                            <div className="text-sm text-slate-600">
                              {b.title} &middot; {b.facilityName}
                            </div>
                            {/* Noten vises altid med det samme - man skal ikke først
                                folde kortet ud for at se den, jf. ønske fra centeret. */}
                            {b.notes && <div className="text-sm text-amber-700 italic mt-0.5">Note: {b.notes}</div>}
                          </div>
                          <span
                            className={`text-xs px-2 py-1 rounded-full border font-medium ${BOOKING_STATUS_CLASSES[b.status]}`}
                          >
                            {BOOKING_STATUS_LABELS[b.status]}
                          </span>
                        </button>
                        {isOpen && (
                          <div className="px-4 pb-4 space-y-2 border-t border-slate-100 pt-3 text-sm">
                            {b.contactName && <div className="text-slate-600">Kontakt: {b.contactName}</div>}
                            {b.contactPhone && (
                              <div className="text-slate-600">
                                Telefon:{" "}
                                <a href={`tel:${b.contactPhone}`} className="text-blue-600">
                                  {b.contactPhone}
                                </a>
                              </div>
                            )}
                            {b.contactEmail && <div className="text-slate-600">E-mail: {b.contactEmail}</div>}
                            {b.accessCode && (
                              <div className="text-slate-600">
                                Dørkode: <span className="font-mono font-semibold">{b.accessCode}</span>
                              </div>
                            )}
                            {b.status !== "aflyst" && (
                              <div className="flex gap-2 mt-2">
                                <button
                                  onClick={() => setEditing(b)}
                                  className="flex-1 rounded-lg border border-slate-300 text-slate-700 py-2.5 text-sm font-medium"
                                >
                                  Rediger
                                </button>
                                <button
                                  onClick={() => cancelBooking(b.id)}
                                  className="flex-1 rounded-lg border border-red-200 text-red-600 py-2.5 text-sm font-medium"
                                >
                                  Aflys booking
                                </button>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
      </div>

      {/* Udskriftsvisning: skjult på skærm, vises kun ved udskrift (Ctrl+P /
          "Udskriv"-knappen ovenfor) - hele ugens program som overskuelige
          tabeller pr. dag, formateret til A4, uden knapper eller farvede
          badges. Man kan bladre frem til fx næste uge og udskrive DEN uge,
          så man kan forberede sig i god tid. */}
      <div className="hidden print:block px-2">
        <h1 className="text-xl font-bold text-black mb-1">
          Program for uge {isoWeekNumber(weekStart)} &middot; {weekRangeLabel(weekStart)}
        </h1>
        <div className="text-xs text-black mb-4">Grenaa Idrætscenter</div>
        {weekDays.map(({ dateStr, items }) => (
          <div key={dateStr} className="mb-4 break-inside-avoid">
            <h2 className="text-sm font-bold text-black border-b border-black pb-0.5 mb-1">
              {capitalizeDaDate(formatDaDateShort(`${dateStr}T00:00:00`))}
            </h2>
            {items.length === 0 ? (
              <div className="text-xs text-black mb-2">Ingen aktiviteter.</div>
            ) : (
              <table className="w-full border-collapse text-sm text-black mb-2">
                <thead>
                  <tr className="border-b border-black text-left">
                    <th className="py-1 pr-2">Tid</th>
                    <th className="py-1 pr-2">Facilitet</th>
                    <th className="py-1 pr-2">Aktivitet</th>
                    <th className="py-1 pr-2">Kontakt</th>
                    <th className="py-1">Note</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((b) => (
                    <tr key={b.id} className="border-b border-slate-400 align-top">
                      <td className="py-1 pr-2 whitespace-nowrap font-medium">
                        {formatDaTime(b.startsAt)}-{formatDaTime(b.endsAt)}
                      </td>
                      <td className="py-1 pr-2">{b.facilityName}</td>
                      <td className="py-1 pr-2">{b.title}</td>
                      <td className="py-1 pr-2">
                        {b.contactName}
                        {b.contactPhone ? ` · ${b.contactPhone}` : ""}
                      </td>
                      <td className="py-1">{b.notes}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        ))}
      </div>

      <button
        onClick={() => setShowNew(true)}
        className="fixed bottom-6 right-6 w-14 h-14 rounded-full bg-blue-600 text-white text-2xl shadow-lg flex items-center justify-center print:hidden"
      >
        +
      </button>

      {showNew && (
        <BookingFormModal
          facilities={facilities}
          organizations={organizations}
          onClose={() => setShowNew(false)}
          onSaved={() => {
            setShowNew(false);
            loadWeek();
          }}
        />
      )}

      {editing && (
        <BookingFormModal
          booking={editing}
          facilities={facilities}
          organizations={organizations}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            setExpanded(null);
            loadWeek();
          }}
        />
      )}
    </div>
  );
}
