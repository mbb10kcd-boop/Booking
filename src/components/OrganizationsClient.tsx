"use client";

import { useState } from "react";
import Link from "next/link";
import type { OrganizationDTO } from "@/lib/clientTypes";

const STATUS_LABELS: Record<OrganizationDTO["status"], string> = {
  godkendt: "Godkendt",
  afventer_godkendelse: "Afventer godkendelse",
  afvist: "Afvist",
};

const STATUS_CLASSES: Record<OrganizationDTO["status"], string> = {
  godkendt: "bg-emerald-50 text-emerald-700 border-emerald-200",
  afventer_godkendelse: "bg-amber-50 text-amber-700 border-amber-200",
  afvist: "bg-slate-100 text-slate-500 border-slate-200",
};

export function OrganizationsClient({ initialOrganizations }: { initialOrganizations: OrganizationDTO[] }) {
  const [organizations, setOrganizations] = useState(initialOrganizations);
  const [showForm, setShowForm] = useState(false);
  const [decidingId, setDecidingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [cvr, setCvr] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [saving, setSaving] = useState(false);

  async function refresh() {
    const res = await fetch("/api/organizations");
    setOrganizations(await res.json());
  }

  async function decide(id: string, status: "godkendt" | "afvist") {
    setDecidingId(id);
    await fetch(`/api/organizations/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    setDecidingId(null);
    refresh();
  }

  async function create() {
    if (!name.trim()) return;
    setSaving(true);
    await fetch("/api/organizations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, cvr, contactName, contactEmail, contactPhone }),
    });
    setSaving(false);
    setName("");
    setCvr("");
    setContactName("");
    setContactEmail("");
    setContactPhone("");
    setShowForm(false);
    refresh();
  }

  const pending = organizations.filter((o) => o.status === "afventer_godkendelse");
  const rest = organizations.filter((o) => o.status !== "afventer_godkendelse");

  return (
    <div className="p-4 md:p-8 max-w-4xl">
      <div className="flex justify-end mb-4">
        <button onClick={() => setShowForm((s) => !s)} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
          {showForm ? "Luk" : "+ Ny forening"}
        </button>
      </div>

      {showForm && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 mb-6 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Navn</label>
              <input value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">CVR</label>
              <input value={cvr} onChange={(e) => setCvr(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Kontaktperson</label>
              <input value={contactName} onChange={(e) => setContactName(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Telefon</label>
              <input value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            </div>
            <div className="col-span-2">
              <label className="block text-sm font-medium text-slate-700 mb-1">E-mail</label>
              <input value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            </div>
          </div>
          <button onClick={create} disabled={saving} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
            {saving ? "Opretter..." : "Opret forening"}
          </button>
        </div>
      )}

      {pending.length > 0 && (
        <div className="mb-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-amber-600 mb-3">
            Afventer godkendelse ({pending.length})
          </h2>
          <div className="rounded-2xl border border-amber-200 bg-amber-50/40 divide-y divide-amber-100">
            {pending.map((o) => (
              <div key={o.id} className="flex items-center justify-between px-4 py-3">
                <div>
                  <div className="font-medium text-slate-900">{o.name}</div>
                  <div className="text-xs text-slate-500">
                    {o.contactName}
                    {o.contactEmail ? ` · ${o.contactEmail}` : ""}
                    {o.contactPhone ? ` · ${o.contactPhone}` : ""}
                  </div>
                  <div className="text-xs text-slate-400">Oprettet via foreningsportalen</div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => decide(o.id, "afvist")}
                    disabled={decidingId === o.id}
                    className="rounded-lg border border-red-200 text-red-600 px-3 py-1.5 text-xs font-medium hover:bg-red-50 disabled:opacity-50"
                  >
                    Afvis
                  </button>
                  <button
                    onClick={() => decide(o.id, "godkendt")}
                    disabled={decidingId === o.id}
                    className="rounded-lg bg-emerald-600 text-white px-3 py-1.5 text-xs font-medium hover:bg-emerald-700 disabled:opacity-50"
                  >
                    {decidingId === o.id ? "Godkender..." : "Godkend"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="rounded-2xl border border-slate-200 bg-white divide-y divide-slate-100">
        {rest.map((o) => (
          <Link key={o.id} href={`/foreninger/${o.id}`} className="flex items-center justify-between px-4 py-3 hover:bg-slate-50">
            <div>
              <div className="font-medium text-slate-900">{o.name}</div>
              <div className="text-xs text-slate-500">{o.contactName}{o.contactEmail ? ` · ${o.contactEmail}` : ""}</div>
            </div>
            <div className="flex items-center gap-3">
              {o.status !== "godkendt" && (
                <span className={`text-xs px-2 py-0.5 rounded-full border ${STATUS_CLASSES[o.status]}`}>
                  {STATUS_LABELS[o.status]}
                </span>
              )}
              <span className="text-slate-300">&rarr;</span>
            </div>
          </Link>
        ))}
        {rest.length === 0 && <div className="px-4 py-8 text-center text-sm text-slate-400">Ingen foreninger endnu.</div>}
      </div>
    </div>
  );
}
