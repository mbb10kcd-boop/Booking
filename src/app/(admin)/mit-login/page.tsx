"use client";

import { useEffect, useState } from "react";

interface Me {
  id: string;
  name: string;
  email: string;
  role: string;
}

const ROLE_LABELS: Record<string, string> = {
  admin: "Administrator",
  medarbejder: "Medarbejder",
  pedel: "Pedel",
  forening: "Forening",
  kunde: "Kunde",
};

export default function MitLoginPage() {
  const [me, setMe] = useState<Me | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [profileMsg, setProfileMsg] = useState<{ type: "ok" | "error"; text: string } | null>(null);
  const [profileSaving, setProfileSaving] = useState(false);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newPassword2, setNewPassword2] = useState("");
  const [passwordMsg, setPasswordMsg] = useState<{ type: "ok" | "error"; text: string } | null>(null);
  const [passwordSaving, setPasswordSaving] = useState(false);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((data) => {
        if (data.user) {
          setMe(data.user);
          setName(data.user.name);
          setEmail(data.user.email);
        }
      });
  }, []);

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    setProfileMsg(null);
    setProfileSaving(true);
    const res = await fetch("/api/auth/me", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email }),
    });
    const data = await res.json().catch(() => ({}));
    setProfileSaving(false);
    if (!res.ok) {
      setProfileMsg({ type: "error", text: data.error || "Kunne ikke gemme" });
      return;
    }
    setProfileMsg({ type: "ok", text: "Gemt" });
  }

  async function savePassword(e: React.FormEvent) {
    e.preventDefault();
    setPasswordMsg(null);
    if (newPassword !== newPassword2) {
      setPasswordMsg({ type: "error", text: "De to nye kodeord er ikke ens" });
      return;
    }
    setPasswordSaving(true);
    const res = await fetch("/api/auth/change-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    const data = await res.json().catch(() => ({}));
    setPasswordSaving(false);
    if (!res.ok) {
      setPasswordMsg({ type: "error", text: data.error || "Kunne ikke skifte kodeord" });
      return;
    }
    setCurrentPassword("");
    setNewPassword("");
    setNewPassword2("");
    setPasswordMsg({ type: "ok", text: "Kodeord skiftet" });
  }

  return (
    <div className="max-w-xl mx-auto p-6 space-y-8">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Mit login</h1>
        {me && (
          <p className="text-sm text-slate-500 mt-1">
            Rolle: {ROLE_LABELS[me.role] ?? me.role}
          </p>
        )}
      </div>

      <form onSubmit={saveProfile} className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        <h2 className="font-medium text-slate-900">Navn og email</h2>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Navn</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
        {profileMsg && (
          <div className={`text-sm rounded-lg px-3 py-2 ${profileMsg.type === "ok" ? "text-green-700 bg-green-50 border border-green-200" : "text-red-600 bg-red-50 border border-red-200"}`}>
            {profileMsg.text}
          </div>
        )}
        <button
          type="submit"
          disabled={profileSaving}
          className="bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-medium rounded-lg px-4 py-2"
        >
          Gem
        </button>
      </form>

      <form onSubmit={savePassword} className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        <h2 className="font-medium text-slate-900">Skift kodeord</h2>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Nuværende kodeord</label>
          <input
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Nyt kodeord (mindst 8 tegn)</label>
          <input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Gentag nyt kodeord</label>
          <input
            type="password"
            value={newPassword2}
            onChange={(e) => setNewPassword2(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
        {passwordMsg && (
          <div className={`text-sm rounded-lg px-3 py-2 ${passwordMsg.type === "ok" ? "text-green-700 bg-green-50 border border-green-200" : "text-red-600 bg-red-50 border border-red-200"}`}>
            {passwordMsg.text}
          </div>
        )}
        <button
          type="submit"
          disabled={passwordSaving}
          className="bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-medium rounded-lg px-4 py-2"
        >
          Skift kodeord
        </button>
      </form>
    </div>
  );
}
