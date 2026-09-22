"use client";

import { useState } from "react";
import type { FacilityDTO } from "@/lib/clientTypes";

const DEFAULT_COLOR = "#2563eb";

/**
 * Navngivet farvepalette til facilitetsfarver, i stedet for en rå
 * farvevælger/-hjul - Martin er farveblind og vælger derfor farve ved at
 * læse navnet, ikke ved at skelne nuancer visuelt. Prikken ved siden af
 * hvert navn er en hjælp for andre medarbejdere, men bevidst ikke det
 * eneste valgkriterie. Sat sammen så navnene også er tydelige at skelne fra
 * hinanden i almindelig sprogbrug (ingen "blå1"/"blå2"-typer).
 */
const COLOR_PALETTE: { name: string; hex: string }[] = [
  { name: "Blå", hex: "#2563eb" },
  { name: "Rød", hex: "#dc2626" },
  { name: "Grøn", hex: "#059669" },
  { name: "Orange", hex: "#f97316" },
  { name: "Lilla", hex: "#7c3aed" },
  { name: "Pink", hex: "#db2777" },
  { name: "Guld/gul", hex: "#ca8a04" },
  { name: "Turkis", hex: "#0891b2" },
  { name: "Brun", hex: "#92400e" },
  { name: "Grå", hex: "#64748b" },
  { name: "Mørkegrøn", hex: "#166534" },
  { name: "Mørkeblå", hex: "#1e3a8a" },
  { name: "Rosa", hex: "#f472b6" },
  { name: "Antracit", hex: "#334155" },
];

function colorName(hex: string | null | undefined): string {
  const match = COLOR_PALETTE.find((c) => c.hex.toLowerCase() === (hex ?? "").toLowerCase());
  return match?.name ?? (hex ? hex : "Ingen");
}

interface EditState {
  name: string;
  color: string;
  capacity: string;
  price: string;
  requiresPayment: boolean;
  conflictMode: "block" | "warn";
  saving: boolean;
}

/**
 * Redigeringspanel for én facilitet. Bevidst et TOPNIVEAU-komponent (ikke
 * defineret inde i FacilitiesClient) - ellers ville React opfatte det som en
 * ny komponent-type ved hvert tastetryk (fordi funktionsreferencen ændrer
 * sig ved hver re-render af den omsluttende komponent), hvilket ville
 * genmontere hele panelet og få inputfelterne til at miste fokus for hvert
 * bogstav der tastes.
 */
function FacilityEditPanel({
  facility,
  edit,
  setEdit,
  onSave,
  onCancel,
}: {
  facility: FacilityDTO;
  edit: EditState;
  setEdit: (e: EditState) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="border-t border-slate-100 bg-blue-50/40 p-4 space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">Navn</label>
          <input
            value={edit.name}
            onChange={(e) => setEdit({ ...edit, name: e.target.value })}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">Kapacitet</label>
          <input
            value={edit.capacity}
            onChange={(e) => setEdit({ ...edit, capacity: e.target.value })}
            type="number"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">Pris pr. time (kr.)</label>
          <input
            value={edit.price}
            onChange={(e) => setEdit({ ...edit, price: e.target.value })}
            type="number"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white"
          />
        </div>
        {facility.parentId && (
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Konflikt med den overordnede facilitet
            </label>
            <select
              value={edit.conflictMode}
              onChange={(e) => setEdit({ ...edit, conflictMode: e.target.value as "block" | "warn" })}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white"
            >
              <option value="block">Blokerer hinanden</option>
              <option value="warn">Kan bookes samtidig, men giv en bemærkning</option>
            </select>
          </div>
        )}
      </div>

      <div>
        <label className="block text-xs font-medium text-slate-700 mb-1.5">
          Farve (vælg ud fra navnet, ikke kun prikken)
        </label>
        <div className="flex flex-wrap gap-1.5">
          {COLOR_PALETTE.map((c) => (
            <button
              key={c.hex}
              type="button"
              onClick={() => setEdit({ ...edit, color: c.hex })}
              className={`flex items-center gap-1.5 rounded-lg border px-2 py-1.5 text-xs ${
                edit.color.toLowerCase() === c.hex.toLowerCase()
                  ? "border-blue-500 bg-blue-100 font-medium text-blue-800"
                  : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
              }`}
            >
              <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: c.hex }} aria-hidden />
              {c.name}
            </button>
          ))}
        </div>
        <div className="mt-2 flex items-center gap-2">
          <label className="text-xs text-slate-500">Eller egen farvekode:</label>
          <input
            value={edit.color}
            onChange={(e) => setEdit({ ...edit, color: e.target.value })}
            className="rounded-lg border border-slate-300 px-2 py-1 text-xs bg-white w-28"
            placeholder="#2563eb"
          />
          <span
            className="w-5 h-5 rounded-full border border-slate-300 shrink-0"
            style={{ backgroundColor: edit.color }}
            aria-hidden
          />
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input
          type="checkbox"
          checked={edit.requiresPayment}
          onChange={(e) => setEdit({ ...edit, requiresPayment: e.target.checked })}
          className="rounded border-slate-300"
        />
        Kræver online betaling ved booking
      </label>

      <div className="flex gap-2">
        <button
          onClick={onSave}
          disabled={edit.saving}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {edit.saving ? "Gemmer..." : "Gem ændringer"}
        </button>
        <button
          onClick={onCancel}
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Annullér
        </button>
      </div>
    </div>
  );
}

export function FacilitiesClient({ initialFacilities }: { initialFacilities: FacilityDTO[] }) {
  const [facilities, setFacilities] = useState(initialFacilities);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [parentId, setParentId] = useState("");
  const [conflictMode, setConflictMode] = useState<"block" | "warn">("block");
  const [capacity, setCapacity] = useState("");
  const [price, setPrice] = useState("0");
  const [requiresPayment, setRequiresPayment] = useState(false);
  const [color, setColor] = useState(DEFAULT_COLOR);
  const [saving, setSaving] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [edit, setEdit] = useState<EditState | null>(null);

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
        color,
      }),
    });
    setSaving(false);
    setName("");
    setParentId("");
    setConflictMode("block");
    setCapacity("");
    setPrice("0");
    setRequiresPayment(false);
    setColor(DEFAULT_COLOR);
    setShowForm(false);
    refresh();
  }

  async function archiveFacility(id: string) {
    await fetch(`/api/facilities/${id}`, { method: "DELETE" });
    refresh();
  }

  function startEdit(f: FacilityDTO) {
    setEditingId(f.id);
    setEdit({
      name: f.name,
      color: f.color ?? DEFAULT_COLOR,
      capacity: f.capacity != null ? String(f.capacity) : "",
      price: f.pricePerHour != null ? String(f.pricePerHour) : "0",
      requiresPayment: !!f.requiresPayment,
      conflictMode: f.conflictMode === "warn" ? "warn" : "block",
      saving: false,
    });
  }

  function cancelEdit() {
    setEditingId(null);
    setEdit(null);
  }

  async function saveEdit(f: FacilityDTO) {
    if (!edit || !edit.name.trim()) return;
    setEdit({ ...edit, saving: true });
    await fetch(`/api/facilities/${f.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: edit.name,
        color: edit.color,
        capacity: edit.capacity ? Number(edit.capacity) : null,
        pricePerHour: Number(edit.price) || 0,
        requiresPayment: edit.requiresPayment,
        ...(f.parentId ? { conflictMode: edit.conflictMode } : {}),
      }),
    });
    setEditingId(null);
    setEdit(null);
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
            <div className="col-span-2">
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Farve</label>
              <div className="flex flex-wrap gap-1.5">
                {COLOR_PALETTE.map((c) => (
                  <button
                    key={c.hex}
                    type="button"
                    onClick={() => setColor(c.hex)}
                    className={`flex items-center gap-1.5 rounded-lg border px-2 py-1.5 text-xs ${
                      color.toLowerCase() === c.hex.toLowerCase()
                        ? "border-blue-500 bg-blue-100 font-medium text-blue-800"
                        : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                    }`}
                  >
                    <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: c.hex }} aria-hidden />
                    {c.name}
                  </button>
                ))}
              </div>
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
                    {` · Farve: ${colorName(f.color)}`}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <button onClick={() => (editingId === f.id ? cancelEdit() : startEdit(f))} className="text-xs text-blue-600 hover:text-blue-800 font-medium">
                  {editingId === f.id ? "Luk" : "Rediger"}
                </button>
                <button onClick={() => archiveFacility(f.id)} className="text-xs text-slate-400 hover:text-red-600">
                  Arkivér
                </button>
              </div>
            </div>
            {editingId === f.id && edit && (
              <FacilityEditPanel facility={f} edit={edit} setEdit={setEdit} onSave={() => saveEdit(f)} onCancel={cancelEdit} />
            )}
            {childrenOf(f.id).length > 0 && (
              <div className="border-t border-slate-100 divide-y divide-slate-50">
                {childrenOf(f.id).filter((c) => !c.archived).map((c) => (
                  <div key={c.id}>
                    <div className="flex items-center justify-between px-4 py-2.5 pl-10 bg-slate-50/50">
                      <div className="text-sm text-slate-700 flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: c.color ?? "#64748b" }} />
                        {c.name}
                        {c.requiresPayment ? ` · ${c.pricePerHour} kr/time` : ""}
                        {c.conflictMode === "warn" && (
                          <span
                            className="inline-block text-[11px] px-1.5 py-0.5 rounded-full border bg-amber-100 text-amber-700 border-amber-300"
                            title="Blokerer ikke - giver kun en bemærkning ved booking"
                          >
                            Advarsel, ikke blokering
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3">
                        <button onClick={() => (editingId === c.id ? cancelEdit() : startEdit(c))} className="text-xs text-blue-600 hover:text-blue-800 font-medium">
                          {editingId === c.id ? "Luk" : "Rediger"}
                        </button>
                        <button onClick={() => archiveFacility(c.id)} className="text-xs text-slate-400 hover:text-red-600">
                          Arkivér
                        </button>
                      </div>
                    </div>
                    {editingId === c.id && edit && (
                      <FacilityEditPanel facility={c} edit={edit} setEdit={setEdit} onSave={() => saveEdit(c)} onCancel={cancelEdit} />
                    )}
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
