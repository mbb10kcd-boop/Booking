"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { formatDaDate, formatDaTime } from "@/lib/ai/messages";
import { BOOKING_STATUS_CLASSES, BOOKING_STATUS_LABELS } from "@/lib/statusLabels";
import { BookingFormModal } from "@/components/BookingFormModal";
import type { BookingDTO, FacilityDTO, OrganizationDTO } from "@/lib/clientTypes";

// /api/pedel/today returner en fuld booking-række (spredt) plus disse to
// ekstra felter - så TodayBooking kan bruges alle steder en BookingDTO kan.
interface TodayBooking extends BookingDTO {
  facilityName: string;
  organizationName?: string;
}

export default function PedelPage() {
  const [bookings, setBookings] = useState<TodayBooking[]>([]);
  const [facilities, setFacilities] = useState<FacilityDTO[]>([]);
  const [organizations, setOrganizations] = useState<OrganizationDTO[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [editing, setEditing] = useState<TodayBooking | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const [b, f, o] = await Promise.all([
      fetch("/api/pedel/today").then((r) => r.json()),
      fetch("/api/facilities").then((r) => r.json()),
      fetch("/api/organizations").then((r) => r.json()),
    ]);
    setBookings(b);
    setFacilities(f);
    setOrganizations(o);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function cancelBooking(id: string) {
    await fetch(`/api/bookings/${id}`, { method: "DELETE" });
    setExpanded(null);
    load();
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="sticky top-0 z-10 bg-white border-b border-slate-200 px-4 py-4 flex items-center justify-between print:hidden">
        <div>
          <div className="text-xs text-slate-400">Pedelvisning</div>
          <h1 className="text-lg font-semibold text-slate-900 capitalize">{formatDaDate(new Date().toISOString())}</h1>
        </div>
        <div className="flex items-center gap-4">
          <button onClick={() => window.print()} className="text-xs text-blue-600 font-medium">
            Udskriv
          </button>
          <Link href="/" className="text-xs text-blue-600">
            Til administration
          </Link>
        </div>
      </div>

      {/* Skærmvisning: interaktive kort, skjules ved udskrift */}
      <div className="p-4 space-y-3 pb-28 print:hidden">
        {loading && <div className="text-center text-slate-400 py-10">Indlæser...</div>}
        {!loading && bookings.length === 0 && (
          <div className="text-center text-slate-400 py-16">Ingen aktiviteter i dag.</div>
        )}
        {bookings.map((b) => {
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
                <span className={`text-xs px-2 py-1 rounded-full border font-medium ${BOOKING_STATUS_CLASSES[b.status]}`}>
                  {BOOKING_STATUS_LABELS[b.status]}
                </span>
              </button>
              {isOpen && (
                <div className="px-4 pb-4 space-y-2 border-t border-slate-100 pt-3 text-sm">
                  {b.contactName && <div className="text-slate-600">Kontakt: {b.contactName}</div>}
                  {b.contactPhone && (
                    <div className="text-slate-600">
                      Telefon: <a href={`tel:${b.contactPhone}`} className="text-blue-600">{b.contactPhone}</a>
                    </div>
                  )}
                  {b.contactEmail && <div className="text-slate-600">E-mail: {b.contactEmail}</div>}
                  {b.accessCode && <div className="text-slate-600">Dørkode: <span className="font-mono font-semibold">{b.accessCode}</span></div>}
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

      {/* Udskriftsvisning: skjult på skærm, vises kun ved udskrift (Ctrl+P /
          "Udskriv"-knappen ovenfor) - en enkel, overskuelig tabel formateret
          til A4, uden knapper eller farvede badges. */}
      <div className="hidden print:block px-2">
        <h1 className="text-xl font-bold text-black capitalize mb-1">Dagens program - {formatDaDate(new Date().toISOString())}</h1>
        <div className="text-xs text-black mb-4">Grenaa Idrætscenter</div>
        {bookings.length === 0 ? (
          <div className="text-sm text-black">Ingen aktiviteter i dag.</div>
        ) : (
          <table className="w-full border-collapse text-sm text-black">
            <thead>
              <tr className="border-b-2 border-black text-left">
                <th className="py-1 pr-2">Tid</th>
                <th className="py-1 pr-2">Facilitet</th>
                <th className="py-1 pr-2">Aktivitet</th>
                <th className="py-1 pr-2">Kontakt</th>
                <th className="py-1">Note</th>
              </tr>
            </thead>
            <tbody>
              {bookings.map((b) => (
                <tr key={b.id} className="border-b border-slate-400 align-top">
                  <td className="py-1.5 pr-2 whitespace-nowrap font-medium">
                    {formatDaTime(b.startsAt)}-{formatDaTime(b.endsAt)}
                  </td>
                  <td className="py-1.5 pr-2">{b.facilityName}</td>
                  <td className="py-1.5 pr-2">{b.title}</td>
                  <td className="py-1.5 pr-2">
                    {b.contactName}
                    {b.contactPhone ? ` · ${b.contactPhone}` : ""}
                  </td>
                  <td className="py-1.5">{b.notes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
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
            load();
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
            load();
          }}
        />
      )}
    </div>
  );
}
