"use client";

import { useState } from "react";
import Link from "next/link";
import type { FacilityDTO } from "@/lib/clientTypes";

interface ScreenRow {
  id: string;
  name: string;
  location: string | null;
  facilityIds: string[] | null;
  layout: string;
}

export function ScreensClient({ initialScreens, facilities }: { initialScreens: ScreenRow[]; facilities: FacilityDTO[] }) {
  const [screens, setScreens] = useState(initialScreens);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [location, setLocation] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  async function refresh() {
    const res = await fetch("/api/screens");
    setScreens(await res.json());
  }

  async function create() {
    if (!name.trim()) return;
    setSaving(true);
    await fetch("/api/screens", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, location, facilityIds: [...selected] }),
    });
    setSaving(false);
    setName("");
    setLocation("");
    setSelected(new Set());
    setShowForm(false);
    refresh();
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="p-4 md:p-8 max-w-3xl">
      <div className="flex justify-end mb-4">
        <button onClick={() => setShowForm((s) => !s)} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
          {showForm ? "Luk" : "+ Ny infoskærm"}
        </button>
      </div>

      {showForm && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 mb-6 space-y-3">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Navn</label>
            <input value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="Fx Reception, Café" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Placering</label>
            <input value={location} onChange={(e) => setLocation(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Vis faciliteter (ingen valgt = vis alle)</label>
            <div className="flex flex-wrap gap-2">
              {facilities.filter((f) => !f.archived).map((f) => (
                <button
                  key={f.id}
                  onClick={() => toggle(f.id)}
                  type="button"
                  className={`text-xs px-2.5 py-1 rounded-full border ${
                    selected.has(f.id) ? "bg-blue-600 text-white border-blue-600" : "bg-white text-slate-600 border-slate-300"
                  }`}
                >
                  {f.name}
                </button>
              ))}
            </div>
          </div>
          <button onClick={create} disabled={saving} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
            {saving ? "Opretter..." : "Opret skærm"}
          </button>
        </div>
      )}

      <div className="rounded-2xl border border-slate-200 bg-white divide-y divide-slate-100">
        {screens.map((s) => (
          <div key={s.id} className="flex items-center justify-between px-4 py-3">
            <div>
              <div className="font-medium text-slate-900">{s.name}</div>
              <div className="text-xs text-slate-500">{s.location}</div>
            </div>
            <Link href={`/skaerm/${s.id}`} target="_blank" className="text-sm text-blue-600 hover:underline">
              Åbn visning &rarr;
            </Link>
          </div>
        ))}
        {screens.length === 0 && <div className="px-4 py-8 text-center text-sm text-slate-400">Ingen infoskærme oprettet.</div>}
      </div>
    </div>
  );
}
