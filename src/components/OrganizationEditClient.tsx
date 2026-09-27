"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface OrganizationEditable {
  id: string;
  name: string;
  cvr: string | null;
  address: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  archived: boolean;
  internal: boolean;
}

export function OrganizationEditClient({
  organization,
  bookingCount,
}: {
  organization: OrganizationEditable;
  bookingCount: number;
}) {
  const router = useRouter();
  const [org, setOrg] = useState(organization);
  const [name, setName] = useState(organization.name);
  const [cvr, setCvr] = useState(organization.cvr ?? "");
  const [address, setAddress] = useState(organization.address ?? "");
  const [contactName, setContactName] = useState(organization.contactName ?? "");
  const [contactEmail, setContactEmail] = useState(organization.contactEmail ?? "");
  const [contactPhone, setContactPhone] = useState(organization.contactPhone ?? "");
  const [saving, setSaving] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [archiving, setArchiving] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const dirty =
    name !== org.name ||
    cvr !== (org.cvr ?? "") ||
    address !== (org.address ?? "") ||
    contactName !== (org.contactName ?? "") ||
    contactEmail !== (org.contactEmail ?? "") ||
    contactPhone !== (org.contactPhone ?? "");

  async function save() {
    if (!name.trim()) {
      setError("Navn må ikke være tomt");
      return;
    }
    setSaving(true);
    setError(null);
    setSavedNotice(false);
    const res = await fetch(`/api/organizations/${org.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        cvr: cvr || null,
        address: address || null,
        contactName: contactName || null,
        contactEmail: contactEmail || null,
        contactPhone: contactPhone || null,
      }),
    });
    setSaving(false);
    if (!res.ok) {
      setError("Kunne ikke gemme ændringerne");
      return;
    }
    const updated = await res.json();
    setOrg((prev) => ({ ...prev, ...updated }));
    setSavedNotice(true);
    setTimeout(() => setSavedNotice(false), 3000);
  }

  async function toggleArchived() {
    setArchiving(true);
    const res = await fetch(`/api/organizations/${org.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ archived: !org.archived }),
    });
    setArchiving(false);
    if (res.ok) {
      const updated = await res.json();
      setOrg((prev) => ({ ...prev, ...updated }));
    }
  }

  async function deleteOrganization() {
    setDeleting(true);
    setDeleteError(null);
    const res = await fetch(`/api/organizations/${org.id}`, { method: "DELETE" });
    if (res.ok) {
      router.push("/foreninger");
      return;
    }
    setDeleting(false);
    const data = await res.json().catch(() => null);
    setDeleteError(data?.error ?? "Kunne ikke slette foreningen");
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4">
      {org.archived && (
        <div className="rounded-lg bg-slate-100 border border-slate-200 px-3 py-2 text-sm text-slate-600">
          Denne forening er arkiveret - den vises ikke i bookingdropdowns eller den offentlige foreningsportal, men
          bevares i historikken.
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 text-sm">
        <div className="col-span-2">
          <label className="block text-slate-500 mb-1">Navn</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-slate-500 mb-1">Kontaktperson</label>
          <input
            value={contactName}
            onChange={(e) => setContactName(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-slate-500 mb-1">Telefon</label>
          <input
            value={contactPhone}
            onChange={(e) => setContactPhone(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-slate-500 mb-1">E-mail</label>
          <input
            value={contactEmail}
            onChange={(e) => setContactEmail(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
          <p className="mt-1 text-xs text-slate-400">
            Bruges automatisk til fremtidige aflysnings- og flyttemails for foreningens bookinger.
          </p>
        </div>
        <div>
          <label className="block text-slate-500 mb-1">CVR</label>
          <input
            value={cvr}
            onChange={(e) => setCvr(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
        <div className="col-span-2">
          <label className="block text-slate-500 mb-1">Adresse</label>
          <input
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex flex-wrap items-center gap-4 pt-1">
        <button
          onClick={save}
          disabled={saving || !dirty}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? "Gemmer..." : "Gem ændringer"}
        </button>
        {savedNotice && <span className="text-sm text-emerald-600">Gemt.</span>}

        <div className="ml-auto flex items-center gap-4">
          {!org.internal && (
            <button
              onClick={toggleArchived}
              disabled={archiving}
              className="text-sm text-slate-500 hover:text-slate-800 disabled:opacity-50"
            >
              {archiving ? "..." : org.archived ? "Genaktivér" : "Arkivér"}
            </button>
          )}
          {!org.internal && bookingCount === 0 && (
            <button onClick={() => setDeleteConfirm(true)} className="text-sm text-slate-400 hover:text-red-700">
              Slet
            </button>
          )}
        </div>
      </div>

      {!org.internal && bookingCount > 0 && (
        <p className="text-xs text-slate-400">
          Foreningen har {bookingCount} booking(er) og kan derfor ikke slettes permanent - brug &quot;Arkivér&quot; hvis
          den ikke længere skal kunne vælges.
        </p>
      )}

      {deleteConfirm && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex flex-wrap items-center gap-3">
          <p className="text-sm text-red-700">
            Slet {org.name} permanent? Dette kan ikke fortrydes (brug i stedet &quot;Arkivér&quot;, hvis foreningen blot
            ikke længere skal kunne vælges).
          </p>
          <button
            onClick={deleteOrganization}
            disabled={deleting}
            className="bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded-lg px-3 py-1.5 disabled:opacity-50"
          >
            {deleting ? "Sletter..." : "Ja, slet permanent"}
          </button>
          <button onClick={() => setDeleteConfirm(false)} className="text-sm text-slate-500 hover:text-slate-800">
            Annullér
          </button>
          {deleteError && <p className="w-full text-sm text-red-700">{deleteError}</p>}
        </div>
      )}
    </div>
  );
}
