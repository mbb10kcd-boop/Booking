"use client";

import { useEffect, useState } from "react";

interface UserRow {
  id: string;
  name: string;
  email: string;
  role: "admin" | "medarbejder" | "pedel";
  active: boolean | null;
  createdAt: string | null;
}

const ROLE_OPTIONS: { value: UserRow["role"]; label: string }[] = [
  { value: "admin", label: "Administrator" },
  { value: "medarbejder", label: "Medarbejder" },
  { value: "pedel", label: "Pedel" },
];

const ROLE_LABELS: Record<string, string> = {
  admin: "Administrator",
  medarbejder: "Medarbejder",
  pedel: "Pedel",
};

export default function BrugerePage() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);

  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState<UserRow["role"]>("medarbejder");
  const [createSaving, setCreateSaving] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [resettingId, setResettingId] = useState<string | null>(null);
  const [resetPasswordValue, setResetPasswordValue] = useState("");
  const [resetError, setResetError] = useState<string | null>(null);
  const [resetSaving, setResetSaving] = useState(false);
  const [resetDoneFor, setResetDoneFor] = useState<{ name: string; password: string } | null>(null);

  async function load() {
    setLoading(true);
    const res = await fetch("/api/users");
    if (res.status === 403) {
      setForbidden(true);
      setLoading(false);
      return;
    }
    const data = await res.json().catch(() => ({ users: [] }));
    setUsers(data.users ?? []);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function createUser(e: React.FormEvent) {
    e.preventDefault();
    setCreateError(null);
    setCreateSaving(true);
    const res = await fetch("/api/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName, email: newEmail, password: newPassword, role: newRole }),
    });
    const data = await res.json().catch(() => ({}));
    setCreateSaving(false);
    if (!res.ok) {
      setCreateError(data.error || "Kunne ikke oprette bruger");
      return;
    }
    setNewName("");
    setNewEmail("");
    setNewPassword("");
    setNewRole("medarbejder");
    setShowCreate(false);
    load();
  }

  async function updateUser(id: string, updates: Partial<{ role: UserRow["role"]; active: boolean }>) {
    setGlobalError(null);
    const res = await fetch(`/api/users/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setGlobalError(data.error || "Kunne ikke opdatere bruger");
      return;
    }
    load();
  }

  function startResetPassword(id: string) {
    setResettingId(id);
    setResetPasswordValue("");
    setResetError(null);
    setResetDoneFor(null);
  }

  async function confirmResetPassword(id: string, name: string) {
    if (resetPasswordValue.length < 8) {
      setResetError("Kodeord skal være mindst 8 tegn");
      return;
    }
    setResetSaving(true);
    setResetError(null);
    const res = await fetch(`/api/users/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: resetPasswordValue }),
    });
    const data = await res.json().catch(() => ({}));
    setResetSaving(false);
    if (!res.ok) {
      setResetError(data.error || "Kunne ikke nulstille kodeord");
      return;
    }
    setResetDoneFor({ name, password: resetPasswordValue });
    setResetPasswordValue("");
  }

  if (forbidden) {
    return (
      <div className="p-6">
        <div className="max-w-md mx-auto bg-white border border-slate-200 rounded-xl p-6 text-center">
          <p className="text-slate-700">Kun administratorer har adgang til brugerstyring.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-900">Brugere</h1>
        <button
          onClick={() => setShowCreate((v) => !v)}
          className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg px-4 py-2"
        >
          {showCreate ? "Luk" : "+ Ny bruger"}
        </button>
      </div>

      {globalError && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{globalError}</div>
      )}

      {showCreate && (
        <form onSubmit={createUser} className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Navn</label>
              <input
                required
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
              <input
                type="email"
                required
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Midlertidigt kodeord</label>
              <input
                required
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                minLength={8}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Rolle</label>
              <select
                value={newRole}
                onChange={(e) => setNewRole(e.target.value as UserRow["role"])}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              >
                {ROLE_OPTIONS.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {createError && (
            <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{createError}</div>
          )}
          <p className="text-xs text-slate-500">
            Giv det midlertidige kodeord til personen mundtligt eller på anden vis - det sendes ikke automatisk, da
            rigtig mailafsendelse endnu ikke er koblet på. Bed personen skifte det under &quot;Mit login&quot; efter
            første login.
          </p>
          <button
            type="submit"
            disabled={createSaving}
            className="bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-medium rounded-lg px-4 py-2"
          >
            Opret bruger
          </button>
        </form>
      )}

      <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
        {loading && <div className="p-4 text-sm text-slate-500">Indlæser…</div>}
        {!loading && users.length === 0 && <div className="p-4 text-sm text-slate-500">Ingen brugere endnu.</div>}
        {users.map((u) => (
          <div key={u.id} className="p-4 space-y-3">
            <div className="flex flex-wrap items-center gap-3 justify-between">
              <div>
                <div className="font-medium text-slate-900">
                  {u.name} {u.active === false && <span className="text-xs text-red-600 font-normal">(deaktiveret)</span>}
                </div>
                <div className="text-sm text-slate-500">{u.email}</div>
              </div>
              <div className="flex items-center gap-2">
                <select
                  value={u.role}
                  onChange={(e) => updateUser(u.id, { role: e.target.value as UserRow["role"] })}
                  className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                >
                  {ROLE_OPTIONS.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </select>
                <button
                  onClick={() => startResetPassword(u.id)}
                  className="text-sm text-slate-500 hover:text-slate-800"
                >
                  Nulstil kodeord
                </button>
                <button
                  onClick={() => updateUser(u.id, { active: u.active === false })}
                  className={`text-sm ${u.active === false ? "text-green-700 hover:text-green-800" : "text-red-600 hover:text-red-700"}`}
                >
                  {u.active === false ? "Aktivér" : "Deaktivér"}
                </button>
              </div>
            </div>
            {resettingId === u.id && (
              <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-2">
                {resetDoneFor && resetDoneFor.name === u.name ? (
                  <>
                    <p className="text-sm text-slate-700">
                      Nyt midlertidigt kodeord til {u.name}: <span className="font-mono font-semibold">{resetDoneFor.password}</span>
                    </p>
                    <p className="text-xs text-slate-500">
                      Giv kodeordet til personen mundtligt eller på anden vis - det sendes ikke automatisk, da rigtig
                      mailafsendelse endnu ikke er koblet på. Bed personen skifte det under &quot;Mit login&quot; efter
                      første login.
                    </p>
                    <button
                      onClick={() => setResettingId(null)}
                      className="text-sm text-slate-500 hover:text-slate-800"
                    >
                      Luk
                    </button>
                  </>
                ) : (
                  <>
                    <label className="block text-sm font-medium text-slate-700">
                      Nyt midlertidigt kodeord (mindst 8 tegn)
                    </label>
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        value={resetPasswordValue}
                        onChange={(e) => setResetPasswordValue(e.target.value)}
                        minLength={8}
                        className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
                      />
                      <button
                        onClick={() => confirmResetPassword(u.id, u.name)}
                        disabled={resetSaving}
                        className="bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-medium rounded-lg px-3 py-1.5"
                      >
                        Nulstil
                      </button>
                      <button
                        onClick={() => setResettingId(null)}
                        className="text-sm text-slate-500 hover:text-slate-800"
                      >
                        Annullér
                      </button>
                    </div>
                    {resetError && <p className="text-sm text-red-600">{resetError}</p>}
                  </>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
      <p className="text-xs text-slate-400">
        Roller: {ROLE_LABELS.admin} har fuld adgang, inkl. brugerstyring her. {ROLE_LABELS.medarbejder} og{" "}
        {ROLE_LABELS.pedel} har i dag adgang til de samme sider som administrator - kun denne side er forbeholdt
        administratorer.
      </p>
    </div>
  );
}
