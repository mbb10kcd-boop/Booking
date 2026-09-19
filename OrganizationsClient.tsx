"use client";

import { useState } from "react";
import Link from "next/link";
import type { OrganizationDTO } from "@/lib/clientTypes";

export function OrganizationsClient({ initialOrganizations }: { initialOrganizations: OrganizationDTO[] }) {
  const [organizations, setOrganizations] = useState(initialOrganizations);
  const [showForm, setShowForm] = useState(false);
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

      <div className="rounded-2xl border border-slate-200 bg-white divide-y divide-slate-100">
        {organizations.map((o) => (
          <Link key={o.id} href={`/foreninger/${o.id}`} className="flex items-center justify-between px-4 py-3 hover:bg-slate-50">
            <div>
              <div className="font-medium text-slate-900">{o.name}</div>
              <div className="text-xs text-slate-500">{o.contactName}{o.contactEmail ? ` · ${o.contactEmail}` : ""}</div>
            </div>
            <span className="text-slate-300">&rarr;</span>
          </Link>
        ))}
        {organizations.length === 0 && <div className="px-4 py-8 text-center text-sm text-slate-400">Ingen foreninger endnu.</div>}
      </div>
    </div>
  );
}
