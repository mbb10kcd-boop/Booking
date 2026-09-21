"use client";

import { useState } from "react";
import { formatDaDate, formatDaTime } from "@/lib/ai/messages";

type Item = {
  id: string;
  status: "afventer" | "godkendt" | "afvist";
  organizationName: string;
  facilityNames: string[];
  startsAt: string;
  endsAt: string;
  notes: string | null;
  extraEmail: string | null;
  createdAt: string | null;
  conflictingBookings: { id: string; title: string; status: string }[];
};

const STATUS_LABELS: Record<Item["status"], string> = {
  afventer: "Afventer",
  godkendt: "Godkendt",
  afvist: "Afvist",
};

const STATUS_CLASSES: Record<Item["status"], string> = {
  afventer: "bg-amber-50 text-amber-700 border-amber-200",
  godkendt: "bg-emerald-50 text-emerald-700 border-emerald-200",
  afvist: "bg-slate-100 text-slate-500 border-slate-200",
};

export function RescheduleRequestsClient({ initialItems }: { initialItems: Item[] }) {
  const [items, setItems] = useState(initialItems);
  const [decidingId, setDecidingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function decide(id: string, status: "godkendt" | "afvist") {
    setDecidingId(id);
    setError(null);
    const res = await fetch(`/api/reschedule-requests/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    setDecidingId(null);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setError(data?.error ?? "Der opstod en fejl.");
      return;
    }
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, status } : it)));
  }

  const pending = items.filter((i) => i.status === "afventer");
  const decided = items.filter((i) => i.status !== "afventer");

  return (
    <div className="p-4 md:p-8 max-w-4xl">
      {error && <div className="mb-4 text-sm text-red-600">{error}</div>}

      {items.length === 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-400">
          Ingen anmodninger endnu.
        </div>
      )}

      {pending.length > 0 && (
        <div className="mb-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-amber-600 mb-3">
            Afventer ({pending.length})
          </h2>
          <div className="rounded-2xl border border-amber-200 bg-amber-50/40 divide-y divide-amber-100">
            {pending.map((it) => (
              <div key={it.id} className="px-4 py-4 space-y-2">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="font-medium text-slate-900">{it.organizationName}</div>
                    <div className="text-sm text-slate-600">{it.facilityNames.join(", ")}</div>
                    <div className="text-sm text-slate-500">
                      {formatDaDate(it.startsAt)}, {formatDaTime(it.startsAt)}-{formatDaTime(it.endsAt)}
                    </div>
                    {it.notes && <div className="text-xs text-slate-400 mt-1">Note: {it.notes}</div>}
                    {it.extraEmail && <div className="text-xs text-slate-400">Ekstra mail: {it.extraEmail}</div>}
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <button
                      onClick={() => decide(it.id, "afvist")}
                      disabled={decidingId === it.id}
                      className="rounded-lg border border-red-200 text-red-600 px-3 py-1.5 text-xs font-medium hover:bg-red-50 disabled:opacity-50"
                    >
                      Afvis
                    </button>
                    <button
                      onClick={() => decide(it.id, "godkendt")}
                      disabled={decidingId === it.id}
                      className="rounded-lg bg-emerald-600 text-white px-3 py-1.5 text-xs font-medium hover:bg-emerald-700 disabled:opacity-50"
                    >
                      {decidingId === it.id ? "Godkender..." : "Godkend"}
                    </button>
                  </div>
                </div>
                {it.conflictingBookings.length > 0 && (
                  <div className="text-xs text-slate-600 bg-white/70 border border-amber-100 rounded-lg px-3 py-2">
                    <span className="font-medium">Optaget af:</span> {it.conflictingBookings.map((b) => b.title).join(", ")}
                    <br />
                    Ved godkendelse aflyses denne/disse booking(er) automatisk, og den forening får besked om
                    aflysningen. Ved afvisning ændres intet, og kun {it.organizationName} får besked.
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {decided.length > 0 && (
        <div>
          {pending.length > 0 && (
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400 mb-3">Afgjort</h2>
          )}
          <div className="rounded-2xl border border-slate-200 bg-white divide-y divide-slate-100">
            {decided.map((it) => (
              <div key={it.id} className="flex items-center justify-between px-4 py-3">
                <div>
                  <div className="font-medium text-slate-900">{it.organizationName}</div>
                  <div className="text-xs text-slate-500">
                    {it.facilityNames.join(", ")} · {formatDaDate(it.startsAt)}, {formatDaTime(it.startsAt)}-
                    {formatDaTime(it.endsAt)}
                  </div>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded-full border ${STATUS_CLASSES[it.status]}`}>
                  {STATUS_LABELS[it.status]}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
