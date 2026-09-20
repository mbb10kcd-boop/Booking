"use client";

import { useState } from "react";
import { REQUEST_LINE_STATUS_CLASSES, REQUEST_LINE_STATUS_LABELS, weekdayName } from "@/lib/statusLabels";
import { formatDaDate, formatDaTime } from "@/lib/ai/messages";
import type { FacilityDTO, BookingDTO } from "@/lib/clientTypes";

interface RequestLine {
  id: string;
  requestId: string;
  weekdayText: string | null;
  weekday: number | null;
  startTime: string;
  endTime: string;
  singleDate: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  facilityText: string | null;
  facilityId: string | null;
  status: string;
  conflictBookingId: string | null;
}

interface RequestRow {
  id: string;
  rawText: string;
  type: string;
  sourceEmail: string | null;
  parsedOrganizationName: string | null;
  parsedContactName: string | null;
  parsedContactEmail: string | null;
  parsedContactPhone: string | null;
  status: string;
  aiSummary: string | null;
}

export function InboxDetailClient({
  request,
  initialLines,
  facilities,
  conflictBookings,
}: {
  request: RequestRow;
  initialLines: RequestLine[];
  facilities: FacilityDTO[];
  conflictBookings: BookingDTO[];
}) {
  const [lines, setLines] = useState(initialLines);
  const [showRaw, setShowRaw] = useState(false);
  const [busyLine, setBusyLine] = useState<string | null>(null);
  const [resultMessage, setResultMessage] = useState<string | null>(null);
  // Linjen der redigeres lige nu (fx hvis fortolkeren ikke sikkert kunne
  // genkende faciliteten, eller tidspunktet skal justeres, før man godkender)
  const [editingLine, setEditingLine] = useState<string | null>(null);
  const [editFacilityId, setEditFacilityId] = useState("");
  const [editStartTime, setEditStartTime] = useState("");
  const [editEndTime, setEditEndTime] = useState("");
  const [editSingleDate, setEditSingleDate] = useState("");

  function facilityName(id: string | null) {
    if (!id) return null;
    return facilities.find((f) => f.id === id)?.name ?? null;
  }

  function conflictBooking(id: string | null) {
    if (!id) return null;
    return conflictBookings.find((b) => b.id === id) ?? null;
  }

  async function act(lineId: string, action: "godkend" | "overtag" | "afvis") {
    setBusyLine(lineId);
    setResultMessage(null);
    const res = await fetch(`/api/inbox/lines/${lineId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    const data = await res.json();
    setBusyLine(null);
    if (!res.ok) {
      setResultMessage(data.error ?? "Der opstod en fejl");
      return;
    }
    if (action === "godkend") {
      const created = data.result?.createdBookingIds?.length ?? 0;
      const skipped = data.result?.skippedDates?.length ?? 0;
      setResultMessage(
        skipped > 0
          ? `${created} booking(er) oprettet. ${skipped} dato(er) har konflikt og blev sprunget over - løs dem enkeltvis.`
          : `${created} booking(er) oprettet.`
      );
    } else if (action === "overtag") {
      const created = data.result?.createdBookingIds?.length ?? 0;
      const cancelled = data.result?.cancelledExistingBookingIds?.length ?? 0;
      setResultMessage(`${created} ny(e) booking(er) oprettet. ${cancelled} eksisterende booking(er) aflyst og besked genereret.`);
    } else if (action === "afvis") {
      setResultMessage("Forespørgslen er afvist, og et høfligt svar er genereret (se Notifikationer).");
    }
    const refreshed = await fetch(`/api/inbox/${request.id}`);
    const full = await refreshed.json();
    setLines(full.lines);
  }

  function startEditing(line: RequestLine) {
    setEditingLine(line.id);
    setEditFacilityId(line.facilityId ?? "");
    setEditStartTime(line.startTime);
    setEditEndTime(line.endTime);
    setEditSingleDate(line.singleDate ?? "");
    setResultMessage(null);
  }

  async function saveEdit(lineId: string) {
    setBusyLine(lineId);
    const updates: Record<string, string> = {};
    if (editFacilityId) updates.facilityId = editFacilityId;
    if (editStartTime) updates.startTime = editStartTime;
    if (editEndTime) updates.endTime = editEndTime;
    if (editSingleDate) updates.singleDate = editSingleDate;
    const res = await fetch(`/api/inbox/lines/${lineId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "rediger", updates }),
    });
    const data = await res.json();
    setBusyLine(null);
    if (!res.ok) {
      setResultMessage(data.error ?? "Kunne ikke gemme rettelsen");
      return;
    }
    setEditingLine(null);
    const refreshed = await fetch(`/api/inbox/${request.id}`);
    const full = await refreshed.json();
    setLines(full.lines);
  }

  return (
    <div className="p-4 md:p-8 max-w-4xl space-y-6">
      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <div className="grid grid-cols-2 gap-3 text-sm mb-3">
          <div>
            <div className="text-slate-500">Forening / kontakt</div>
            <div className="font-medium text-slate-900">
              {request.parsedOrganizationName ?? request.parsedContactName ?? "Ukendt"}
            </div>
          </div>
          <div>
            <div className="text-slate-500">Kontaktoplysninger</div>
            <div className="font-medium text-slate-900">
              {request.parsedContactEmail ?? request.sourceEmail ?? "-"} {request.parsedContactPhone ? `· ${request.parsedContactPhone}` : ""}
            </div>
          </div>
        </div>
        <p className="text-sm text-slate-600 bg-slate-50 rounded-lg px-3 py-2">{request.aiSummary}</p>
        <button onClick={() => setShowRaw((s) => !s)} className="text-xs text-blue-600 hover:underline mt-2">
          {showRaw ? "Skjul original mail" : "Vis original mail"}
        </button>
        {showRaw && (
          <pre className="mt-2 text-xs bg-slate-900 text-slate-100 rounded-lg p-3 whitespace-pre-wrap font-mono">
            {request.rawText}
          </pre>
        )}
      </div>

      {resultMessage && (
        <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">{resultMessage}</div>
      )}

      <div className="space-y-3">
        {lines.map((line) => {
          const conflict = conflictBooking(line.conflictBookingId);
          const isBusy = busyLine === line.id;
          const period = line.periodStart
            ? `${formatDaDate(line.periodStart + "T00:00:00").split(",")[1]?.trim() ?? line.periodStart} - ${
                formatDaDate(line.periodEnd + "T00:00:00").split(",")[1]?.trim() ?? line.periodEnd
              }`
            : line.singleDate
            ? formatDaDate(line.singleDate + "T00:00:00")
            : "Ukendt dato";

          return (
            <div key={line.id} className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="font-medium text-slate-900">
                    {line.weekdayText ? weekdayName(line.weekday) : ""} {line.startTime}-{line.endTime}
                  </span>
                  <span className="text-sm text-slate-500">{facilityName(line.facilityId) ?? line.facilityText ?? "Ukendt facilitet"}</span>
                  <span className="text-xs text-slate-400">{period}</span>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${REQUEST_LINE_STATUS_CLASSES[line.status]}`}>
                  {REQUEST_LINE_STATUS_LABELS[line.status]}
                </span>
              </div>

              {line.status === "konflikt" && conflict && (
                <div className="rounded-lg bg-red-50 border border-red-100 px-3 py-2 text-sm text-red-700 mb-3">
                  {formatDaDate(conflict.startsAt)} kl. {formatDaTime(conflict.startsAt)}-{formatDaTime(conflict.endsAt)} i{" "}
                  {facilityName(conflict.facilityId)} er allerede booket af <strong>{conflict.title}</strong>.
                </div>
              )}
              {line.status === "konflikt" && !line.facilityId && (
                <div className="rounded-lg bg-amber-50 border border-amber-100 px-3 py-2 text-sm text-amber-700 mb-3">
                  Kunne ikke sikkert genkende faciliteten ({line.facilityText ?? "ikke fundet"}). Ret facilitet/tid nedenfor,
                  eller afvis forespørgslen.
                </div>
              )}

              {editingLine === line.id && (
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 mb-3 space-y-2">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <div className="col-span-2 sm:col-span-1">
                      <label className="block text-xs text-slate-500 mb-0.5">Facilitet</label>
                      <select
                        value={editFacilityId}
                        onChange={(e) => setEditFacilityId(e.target.value)}
                        className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                      >
                        <option value="">Vælg facilitet…</option>
                        {facilities.map((f) => (
                          <option key={f.id} value={f.id}>
                            {f.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-slate-500 mb-0.5">Start</label>
                      <input
                        type="time"
                        value={editStartTime}
                        onChange={(e) => setEditStartTime(e.target.value)}
                        className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-slate-500 mb-0.5">Slut</label>
                      <input
                        type="time"
                        value={editEndTime}
                        onChange={(e) => setEditEndTime(e.target.value)}
                        className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                      />
                    </div>
                    {line.singleDate && (
                      <div>
                        <label className="block text-xs text-slate-500 mb-0.5">Dato</label>
                        <input
                          type="date"
                          value={editSingleDate}
                          onChange={(e) => setEditSingleDate(e.target.value)}
                          className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                        />
                      </div>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => saveEdit(line.id)}
                      disabled={isBusy}
                      className="rounded-lg bg-slate-800 text-white px-3 py-1.5 text-sm font-medium hover:bg-slate-900 disabled:opacity-50"
                    >
                      Gem rettelse
                    </button>
                    <button
                      onClick={() => setEditingLine(null)}
                      className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-white"
                    >
                      Annullér
                    </button>
                  </div>
                </div>
              )}

              {!["godkendt", "afvist"].includes(line.status) && (
                <div className="flex flex-wrap gap-2">
                  {line.status === "ledig" && (
                    <button
                      onClick={() => act(line.id, "godkend")}
                      disabled={isBusy}
                      className="rounded-lg bg-emerald-600 text-white px-3 py-1.5 text-sm font-medium hover:bg-emerald-700 disabled:opacity-50"
                    >
                      Godkend booking
                    </button>
                  )}
                  {line.status === "konflikt" && line.facilityId && (
                    <button
                      onClick={() => act(line.id, "overtag")}
                      disabled={isBusy}
                      className="rounded-lg bg-amber-600 text-white px-3 py-1.5 text-sm font-medium hover:bg-amber-700 disabled:opacity-50"
                    >
                      Overtag tid (aflys eksisterende)
                    </button>
                  )}
                  {editingLine !== line.id && (
                    <button
                      onClick={() => startEditing(line)}
                      disabled={isBusy}
                      className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                    >
                      Ret facilitet/tid
                    </button>
                  )}
                  <button
                    onClick={() => act(line.id, "afvis")}
                    disabled={isBusy}
                    className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                  >
                    Afvis forespørgsel
                  </button>
                </div>
              )}

              {line.status === "godkendt" && (
                <div className="text-sm text-emerald-700">Booking oprettet.</div>
              )}
              {line.status === "afvist" && <div className="text-sm text-slate-500">Forespørgslen er afvist, svar er sendt.</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
