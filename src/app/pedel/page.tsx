"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { formatDaDate, formatDaTime } from "@/lib/ai/messages";
import { BOOKING_STATUS_CLASSES, BOOKING_STATUS_LABELS } from "@/lib/statusLabels";
import { BookingFormModal } from "@/components/BookingFormModal";
import type { FacilityDTO, OrganizationDTO } from "@/lib/clientTypes";

interface TodayBooking {
  id: string;
  facilityId: string;
  facilityName: string;
  organizationName?: string;
  title: string;
  startsAt: string;
  endsAt: string;
  status: string;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  notes: string | null;
  accessCode: string | null;
}

export default function PedelPage() {
  const [bookings, setBookings] = useState<TodayBooking[]>([]);
  const [facilities, setFacilities] = useState<FacilityDTO[]>([]);
  const [organizations, setOrganizations] = useState<OrganizationDTO[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
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
      <div className="sticky top-0 z-10 bg-white border-b border-slate-200 px-4 py-4 flex items-center justify-between">
        <div>
          <div className="text-xs text-slate-400">Pedelvisning</div>
          <h1 className="text-lg font-semibold text-slate-900 capitalize">{formatDaDate(new Date().toISOString())}</h1>
        </div>
        <Link href="/" className="text-xs text-blue-600">
          Til administration
        </Link>
      </div>

      <div className="p-4 space-y-3 pb-28">
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
                  {b.notes && <div className="text-slate-600">Note: {b.notes}</div>}
                  {b.accessCode && <div className="text-slate-600">Dørkode: <span className="font-mono font-semibold">{b.accessCode}</span></div>}
                  {b.status !== "aflyst" && (
                    <button
                      onClick={() => cancelBooking(b.id)}
                      className="w-full mt-2 rounded-lg border border-red-200 text-red-600 py-2.5 text-sm font-medium"
                    >
                      Aflys booking
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <button
        onClick={() => setShowNew(true)}
        className="fixed bottom-6 right-6 w-14 h-14 rounded-full bg-blue-600 text-white text-2xl shadow-lg flex items-center justify-center"
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
    </div>
  );
}
