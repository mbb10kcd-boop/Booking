"use client";

import { useState } from "react";
import type { FacilityDTO } from "@/lib/clientTypes";

export function FacilitiesClient({ initialFacilities }: { initialFacilities: FacilityDTO[] }) {
  const [facilities, setFacilities] = useState(initialFacilities);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [parentId, setParentId] = useState("");
  const [conflictMode, setConflictMode] = useState<"block" | "warn">("block");
  const [capacity, setCapacity] = useState("");
  const [price, setPrice] = useState("0");
  const [requiresPayment, setRequiresPayment] = useState(false);
  const [saving, setSaving] = useState(false);

  const topLevel = facilities.filter((f) => !f.parentId);

  function childrenOf(id: string) {
    return facilities.filter((f) => f.parentId === id);
  }

  async function refresh() {
    const res = await fetch("/api/facilities");
    setFacilities(await res.json());
  }

  async function createFacility() {
    if (!name.trim()) return;
    setSaving(true);
    await fetch("/api/facilities", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        parentId: parentId || null,
        conflictMode: parentId ? conflictMode : "block",
        capacity: capacity ? Number(capacity) : null,
        pricePerHour: Number(price) || 0,
        requiresPayment,
      }),
    });
    setSaving(false);
    setName("");
    setParentId("");
    setConflictMode("block");
    setCapacity("");
    setPrice("0");
    setRequiresPayment(false);
    setShowForm(false);
    refresh();
  }

  async function archiveFacility(id: string) {
    await fetch(`/api/facilities/${id}`, { method: "DELETE" });
    refresh();
  }

  return (
    <div className="p-4 md:p-8 max-w-4xl">
      <div className="flex justify-end mb-4">
        <button onClick={() => setShowForm((s) => !s)} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
          {showForm ? "Luk" : "+ Ny facilitet"}
        </button>
      </div>

      {showForm && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 mb-6 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Navn</label>
              <input value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="Fx Hal 3, eller Hal 1A for en underressource" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Overordnet facilitet (valgfri)</label>
              <select value={parentId} onChange={(e) => setParentId(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
                <option value="">Ingen (topniveau)</option>
                {topLevel.map((f) => (
                  <option key={f.id} value={f.id}>{f.name}</option>
                ))}
              </select>
            </div>
            {parentId && (
              <div className="col-span-2">
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Konflikt med den overordnede facilitet
                </label>
                <select
                  value={conflictMode}
                  onChange={(e) => setConflictMode(e.target.value as "block" | "warn")}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                >
                  <option value="block">Blokerer hinanden (standard) - fx en badmintonbane i træningshallen</option>
                  <option value="warn">Kan bookes samtidig, men giv en bemærkning - fx en klatrevæg i opvisningshallen</option>
                </select>
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Kapacitet</label>
              <input value={capacity} onChange={(e) => setCapacity(e.target.value)} type="number" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Pris pr. time (kr.)</label>
              <input value={price} onChange={(e) => setPrice(e.target.value)} type="number" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={requiresPayment} onChange={(e) => setRequiresPayment(e.target.checked)} className="rounded border-slate-300" />
            Kræver online betaling ved booking
          </label>
          <button onClick={createFacility} disabled={saving} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
            {saving ? "Opretter..." : "Opret facilitet"}
          </button>
        </div>
      )}

      <div className="space-y-3">
        {topLevel.filter((f) => !f.archived).map((f) => (
          <div key={f.id} className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3">
              <div className="flex items-center gap-3">
                <span className="w-3 h-3 rounded-full" style={{ backgroundColor: f.color ?? "#64748b" }} />
                <div>
                  <div className="font-medium text-slate-900">{f.name}</div>
                  <div className="text-xs text-slate-500">
                    {f.capacity ? `Kapacitet: ${f.capacity}` : "Ingen kapacitet angivet"}
                    {f.requiresPayment ? ` · ${f.pricePerHour} kr/time` : ""}
                  </div>
                </div>
              </div>
              <button onClick={() => archiveFacility(f.id)} className="text-xs text-slate-400 hover:text-red-600">
                Arkivér
              </button>
            </div>
            {childrenOf(f.id).length > 0 && (
              <div className="border-t border-slate-100 divide-y divide-slate-50">
                {childrenOf(f.id).filter((c) => !c.archived).map((c) => (
                  <div key={c.id} className="flex items-center justify-between px-4 py-2.5 pl-10 bg-slate-50/50">
                    <div className="text-sm text-slate-700">
                      {c.name}
                      {c.requiresPayment ? ` · ${c.pricePerHour} kr/time` : ""}
                      {c.conflictMode === "warn" && (
                        <span
                          className="ml-2 inline-block text-[11px] px-1.5 py-0.5 rounded-full border bg-amber-100 text-amber-700 border-amber-300"
                          title="Blokerer ikke - giver kun en bemærkning ved booking"
                        >
                          Advarsel, ikke blokering
                        </span>
                      )}
                    </div>
                    <button onClick={() => archiveFacility(c.id)} className="text-xs text-slate-400 hover:text-red-600">
                      Arkivér
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
