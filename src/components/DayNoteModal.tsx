"use client";

import { useState } from "react";
import type { DayNoteDTO } from "@/lib/clientTypes";
import { formatDaDate } from "@/lib/ai/messages";

/**
 * Opret/redigér/slet en dagsnote (fx "Tekniker kommer til ventilationen kl.
 * 10" eller "Brandøvelse i Fit og Sund") - fritekst knyttet til en dato,
 * uafhængig af de almindelige bookinger. Vises både i kalenderen (se
 * CalendarClient) og i pedelvisningen (se /pedel), så pedellerne husker det
 * uden at det kræver en decideret booking af en facilitet.
 */
export function DayNoteModal({
  date,
  note,
  onClose,
  onSaved,
  onDeleted,
}: {
  /** Datoen ("YYYY-MM-DD") noten oprettes på - kun relevant når `note` ikke er sat. */
  date: string;
  /** Angiv denne for at redigere/slette en eksisterende note i stedet for at oprette en ny. */
  note?: DayNoteDTO;
  onClose: () => void;
  onSaved: () => void;
  onDeleted: () => void;
}) {
  const [text, setText] = useState(note?.text ?? "");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isEditing = !!note;

  async function save() {
    if (!text.trim()) {
      setError("Skriv en note.");
      return;
    }
    setSaving(true);
    setError(null);
    const res = await fetch(isEditing ? `/api/day-notes/${note!.id}` : "/api/day-notes", {
      method: isEditing ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(isEditing ? { text } : { date, text }),
    });
    setSaving(false);
    if (!res.ok) {
      setError("Der opstod en fejl. Prøv igen.");
      return;
    }
    onSaved();
  }

  async function remove() {
    if (!note) return;
    setDeleting(true);
    await fetch(`/api/day-notes/${note.id}`, { method: "DELETE" });
    setDeleting(false);
    onDeleted();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-slate-900/40 p-0 md:p-4">
      <div className="w-full md:max-w-sm bg-white rounded-t-2xl md:rounded-2xl shadow-xl">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <h3 className="font-semibold text-slate-900">{isEditing ? "Rediger dagsnote" : "Ny dagsnote"}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 text-xl leading-none">
            &times;
          </button>
        </div>
        <div className="p-5 space-y-3">
          <div className="text-sm text-slate-500 capitalize">{formatDaDate(`${date}T00:00:00`)}</div>
          {error && <div className="text-sm text-red-600">{error}</div>}
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={3}
            autoFocus
            placeholder='Fx "Tekniker kommer til ventilationen kl. 10" eller "Brandøvelse i Fit og Sund"'
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
          <div className="text-xs text-slate-400">
            Vises både her i kalenderen og i pedelvisningen, så pedellerne kan se den.
          </div>
        </div>
        <div className="px-5 py-4 border-t border-slate-100 flex gap-3">
          {isEditing && (
            <button
              onClick={remove}
              disabled={deleting}
              className="rounded-lg border border-red-200 text-red-600 px-3 py-2.5 text-sm font-medium hover:bg-red-50 disabled:opacity-50"
            >
              {deleting ? "Sletter..." : "Slet note"}
            </button>
          )}
          <button onClick={onClose} className="flex-1 rounded-lg border border-slate-300 py-2.5 text-sm font-medium text-slate-700">
            Annullér
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="flex-1 rounded-lg bg-blue-600 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? "Gemmer..." : "Gem"}
          </button>
        </div>
      </div>
    </div>
  );
}
