"use client";

import { useState } from "react";
import Link from "next/link";
import { REQUEST_LINE_STATUS_CLASSES, REQUEST_LINE_STATUS_LABELS } from "@/lib/statusLabels";

interface RequestLine {
  id: string;
  status: string;
}

interface BookingRequestRow {
  id: string;
  rawText: string;
  type: string;
  parsedOrganizationName: string | null;
  parsedContactName: string | null;
  status: string;
  aiSummary: string | null;
  createdAt: string | null;
  lines: RequestLine[];
}

export function InboxClient({ initialRequests }: { initialRequests: BookingRequestRow[] }) {
  const [requests, setRequests] = useState(initialRequests);
  const [showForm, setShowForm] = useState(false);
  const [rawText, setRawText] = useState("");
  const [sourceEmail, setSourceEmail] = useState("");
  const [saving, setSaving] = useState(false);

  async function refresh() {
    const res = await fetch("/api/inbox");
    setRequests(await res.json());
  }

  async function submitMail() {
    if (!rawText.trim()) return;
    setSaving(true);
    await fetch("/api/inbox", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rawText, sourceEmail: sourceEmail || undefined }),
    });
    setSaving(false);
    setRawText("");
    setSourceEmail("");
    setShowForm(false);
    refresh();
  }

  const sorted = [...requests].sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));

  return (
    <div className="p-4 md:p-8 max-w-4xl">
      <div className="flex justify-end mb-4">
        <button onClick={() => setShowForm((s) => !s)} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
          {showForm ? "Luk" : "+ Indsæt/videresend mail"}
        </button>
      </div>

      {showForm && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 mb-6 space-y-3">
          <p className="text-sm text-slate-500">
            Indsæt teksten fra en bookingmail (sæsonønsker eller en enkelt forespørgsel). Systemet forsøger automatisk
            at finde forening, kontaktoplysninger, ønsket facilitet, dag/dato og tidsrum.
          </p>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Afsenders e-mail (valgfri)</label>
            <input
              value={sourceEmail}
              onChange={(e) => setSourceEmail(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder="afsender@forening.dk"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Mailtekst</label>
            <textarea
              value={rawText}
              onChange={(e) => setRawText(e.target.value)}
              rows={8}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono"
              placeholder={"GIF Gymnastik ønsker:\nMandag 16.00-18.00 i Hal 1\n..."}
            />
          </div>
          <button onClick={submitMail} disabled={saving} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
            {saving ? "Fortolker mail..." : "Fortolk mail"}
          </button>
        </div>
      )}

      <div className="space-y-3">
        {sorted.map((r) => {
          const conflictCount = r.lines.filter((l) => l.status === "konflikt").length;
          const pendingCount = r.lines.filter((l) => l.status === "ledig").length;
          return (
            <Link
              key={r.id}
              href={`/indbakke/${r.id}`}
              className="block rounded-2xl border border-slate-200 bg-white p-4 hover:border-slate-300 transition-colors"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-slate-900">
                      {r.parsedOrganizationName ?? r.parsedContactName ?? "Ukendt afsender"}
                    </span>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200">
                      {r.type === "saeson" ? "Sæsonbooking" : "Enkelt forespørgsel"}
                    </span>
                    {r.status === "ny" && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 border border-blue-200">Ny</span>
                    )}
                  </div>
                  <p className="text-sm text-slate-500 mt-1 truncate">{r.aiSummary}</p>
                </div>
                <div className="flex gap-2 shrink-0">
                  {conflictCount > 0 && (
                    <span className="text-xs px-2 py-1 rounded-full bg-red-100 text-red-700 border border-red-200 font-medium">
                      {conflictCount} konflikt{conflictCount > 1 ? "er" : ""}
                    </span>
                  )}
                  {pendingCount > 0 && (
                    <span className="text-xs px-2 py-1 rounded-full bg-emerald-100 text-emerald-700 border border-emerald-200 font-medium">
                      {pendingCount} ledig{pendingCount > 1 ? "e" : ""}
                    </span>
                  )}
                </div>
              </div>
            </Link>
          );
        })}
        {sorted.length === 0 && (
          <div className="rounded-2xl border border-dashed border-slate-200 p-10 text-center text-slate-400">
            Indbakken er tom.
          </div>
        )}
      </div>
    </div>
  );
}
