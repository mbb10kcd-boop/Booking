"use client";

import { useState } from "react";
import type { BookingDTO, FacilityDTO, OrganizationDTO } from "@/lib/clientTypes";
import { formatDaDate, formatDaTime } from "@/lib/ai/messages";

function toLocalInput(iso: string) {
  return iso.slice(0, 16);
}

export function BookingFormModal({
  facilities,
  organizations,
  defaultFacilityId,
  defaultStart,
  onClose,
  onSaved,
}: {
  facilities: FacilityDTO[];
  organizations: OrganizationDTO[];
  defaultFacilityId?: string;
  defaultStart?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [facilityId, setFacilityId] = useState(defaultFacilityId ?? facilities[0]?.id ?? "");
  const [title, setTitle] = useState("");
  const [organizationId, setOrganizationId] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [start, setStart] = useState(defaultStart ? toLocalInput(defaultStart) : "");
  const [end, setEnd] = useState("");
  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState("reserveret");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<BookingDTO[] | null>(null);

  async function submit(force: boolean) {
    if (!facilityId || !start || !end) {
      setError("Udfyld facilitet, starttid og sluttid.");
      return;
    }
    setSaving(true);
    setError(null);
    const res = await fetch("/api/bookings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        facilityId,
        title: title || "Booking",
        organizationId: organizationId || null,
        contactName: contactName || null,
        contactEmail: contactEmail || null,
        // datetime-local giver "YYYY-MM-DDTHH:mm" - vi gemmer altid naive
        // lokale klokkeslæt-strenge (se src/lib/date.ts), aldrig UTC/toISOString.
        startsAt: start.length === 16 ? `${start}:00` : start,
        endsAt: end.length === 16 ? `${end}:00` : end,
        status,
        notes: notes || null,
        force,
      }),
    });
    setSaving(false);
    if (res.status === 409) {
      const data = await res.json();
      setConflicts(data.conflicts);
      return;
    }
    if (!res.ok) {
      setError("Der opstod en fejl. Prøv igen.");
      return;
    }
    onSaved();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-slate-900/40 p-0 md:p-4">
      <div className="w-full md:max-w-lg bg-white rounded-t-2xl md:rounded-2xl shadow-xl max-h-[90vh] overflow-y-auto">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between sticky top-0 bg-white">
          <h3 className="font-semibold text-slate-900">Ny booking</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 text-xl leading-none">
            &times;
          </button>
        </div>

        <div className="p-5 space-y-4">
          {conflicts && conflicts.length > 0 && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-4 space-y-2">
              <div className="font-medium text-red-800 text-sm">Tiden konflikter med eksisterende booking(er):</div>
              {conflicts.map((c) => (
                <div key={c.id} className="text-sm text-red-700">
                  {c.title} - {formatDaDate(c.startsAt)} {formatDaTime(c.startsAt)}-{formatDaTime(c.endsAt)}
                </div>
              ))}
              <button
                onClick={() => submit(true)}
                className="mt-2 w-full rounded-lg bg-red-600 text-white text-sm font-medium py-2 hover:bg-red-700"
              >
                Overskriv alligevel og opret booking
              </button>
            </div>
          )}

          {error && <div className="text-sm text-red-600">{error}</div>}

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Facilitet</label>
            <select
              value={facilityId}
              onChange={(e) => setFacilityId(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            >
              {facilities
                .filter((f) => !f.archived)
                .map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.parentId ? "  – " : ""}
                    {f.name}
                  </option>
                ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Titel</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Fx GIF Gymnastik - træning"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Start</label>
              <input
                type="datetime-local"
                value={start}
                onChange={(e) => setStart(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Slut</label>
              <input
                type="datetime-local"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Forening (valgfri)</label>
            <select
              value={organizationId}
              onChange={(e) => setOrganizationId(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="">Ingen</option>
              {organizations.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Kontaktnavn</label>
              <input
                value={contactName}
                onChange={(e) => setContactName(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Kontakt e-mail</label>
              <input
                value={contactEmail}
                onChange={(e) => setContactEmail(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Status</label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="reserveret">Reserveret</option>
              <option value="bekraeftet">Bekræftet</option>
              <option value="afventer_godkendelse">Afventer godkendelse</option>
              <option value="midlertidig">Midlertidig</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Noter</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
        </div>

        <div className="px-5 py-4 border-t border-slate-100 flex gap-3 sticky bottom-0 bg-white">
          <button onClick={onClose} className="flex-1 rounded-lg border border-slate-300 py-2.5 text-sm font-medium text-slate-700">
            Annullér
          </button>
          <button
            onClick={() => submit(false)}
            disabled={saving}
            className="flex-1 rounded-lg bg-blue-600 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? "Gemmer..." : "Opret booking"}
          </button>
        </div>
      </div>
    </div>
  );
}
