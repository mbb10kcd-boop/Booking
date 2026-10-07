"use client";

import { useCallback, useEffect, useState } from "react";

type Code = {
  id: string;
  code: string;
  label: string | null;
  percentOff: number | null;
  amountOff: number | null;
  maxUses: number | null;
  usedCount: number;
  validFrom: string | null;
  validUntil: string | null;
  active: boolean;
};

const fmtDate = (d: string | null) => (d ? d.split("-").reverse().join("/") : null);

function describe(c: Code): string {
  const parts: string[] = [];
  if (c.percentOff) parts.push(c.percentOff >= 100 ? "Gratis (100 %)" : `${c.percentOff} % rabat`);
  if (c.amountOff) parts.push(`${c.amountOff} kr. rabat`);
  return parts.join(" + ");
}

export function DiscountCodesClient() {
  const [codes, setCodes] = useState<Code[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [code, setCode] = useState("");
  const [label, setLabel] = useState("");
  const [kind, setKind] = useState<"gratis" | "procent" | "beloeb">("gratis");
  const [value, setValue] = useState("");
  const [maxUses, setMaxUses] = useState("");
  const [validFrom, setValidFrom] = useState("");
  const [validUntil, setValidUntil] = useState("");

  const load = useCallback(async () => {
    const res = await fetch("/api/discount-codes", { cache: "no-store" });
    if (res.ok) setCodes(await res.json());
  }, []);

  useEffect(() => {
    queueMicrotask(load);
  }, [load]);

  async function create() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/discount-codes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code,
        label,
        percentOff: kind === "gratis" ? 100 : kind === "procent" ? value : null,
        amountOff: kind === "beloeb" ? value : null,
        maxUses,
        validFrom,
        validUntil,
      }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(data.error ?? "Kunne ikke oprette koden");
      return;
    }
    setCode("");
    setLabel("");
    setValue("");
    setMaxUses("");
    setValidFrom("");
    setValidUntil("");
    load();
  }

  async function toggle(c: Code) {
    await fetch(`/api/discount-codes/${c.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !c.active }),
    });
    load();
  }

  async function remove(c: Code) {
    if (!window.confirm(`Slet rabatkoden ${c.code}? (Allerede oprettede bookinger påvirkes ikke.)`)) return;
    await fetch(`/api/discount-codes/${c.id}`, { method: "DELETE" });
    load();
  }

  const input = "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm";

  return (
    <div className="p-4 md:p-8 max-w-4xl space-y-8">
      <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4">
        <h2 className="font-semibold text-slate-900">Opret rabatkode</h2>
        <p className="text-sm text-slate-500">
          Koden indtastes af gæsten, når de booker privat (fx pickleball/badminton). Er koden gratis, springes betalingen
          over, og gæsten får dørkoden med det samme.
        </p>
        {error && <div className="rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2">{error}</div>}
        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Kode</label>
            <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="fx SOMMERHUS-SOLHYTTEN" className={`${input} uppercase`} />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Beskrivelse (kun til jer)</label>
            <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="fx Sommerhuspakke - Solhytten" className={input} />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Rabat</label>
            <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} className={input}>
              <option value="gratis">Gratis (100 %)</option>
              <option value="procent">Procent</option>
              <option value="beloeb">Fast beløb i kr.</option>
            </select>
          </div>
          {kind !== "gratis" && (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">{kind === "procent" ? "Procent (1-100)" : "Beløb (kr.)"}</label>
              <input value={value} onChange={(e) => setValue(e.target.value)} inputMode="decimal" className={input} />
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Maks. antal brug (tom = ubegrænset)</label>
            <input value={maxUses} onChange={(e) => setMaxUses(e.target.value)} inputMode="numeric" placeholder="fx 1 for en engangskode" className={input} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Gælder fra</label>
              <input type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} className={input} />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Gælder til</label>
              <input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} className={input} />
            </div>
          </div>
        </div>
        <button
          onClick={create}
          disabled={busy || !code.trim() || (kind !== "gratis" && !value)}
          className="rounded-xl bg-blue-600 text-white px-5 py-2.5 text-sm font-medium disabled:opacity-40"
        >
          {busy ? "Opretter..." : "Opret rabatkode"}
        </button>
      </div>

      <div className="space-y-3">
        <h2 className="font-semibold text-slate-900">Rabatkoder</h2>
        {!codes ? (
          <div className="text-sm text-slate-400">Henter...</div>
        ) : codes.length === 0 ? (
          <div className="rounded-xl bg-slate-50 border border-slate-200 px-4 py-6 text-center text-sm text-slate-500">Ingen rabatkoder endnu.</div>
        ) : (
          codes.map((c) => {
            const exhausted = c.maxUses !== null && c.usedCount >= c.maxUses;
            return (
              <div key={c.id} className={`rounded-xl border bg-white px-4 py-3 ${c.active && !exhausted ? "border-slate-200" : "border-slate-200 opacity-60"}`}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-mono font-semibold text-slate-900">{c.code}</div>
                    {c.label && <div className="text-sm text-slate-500">{c.label}</div>}
                    <div className="text-sm text-slate-700 mt-1">{describe(c)}</div>
                    <div className="text-xs text-slate-500 mt-1">
                      Brugt {c.usedCount}
                      {c.maxUses !== null ? ` af ${c.maxUses}` : " gange"}
                      {c.validFrom || c.validUntil
                        ? ` · gælder ${c.validFrom ? `fra ${fmtDate(c.validFrom)} ` : ""}${c.validUntil ? `til ${fmtDate(c.validUntil)}` : ""}`
                        : ""}
                      {exhausted && " · opbrugt"}
                      {!c.active && " · slået fra"}
                    </div>
                  </div>
                  <div className="flex gap-3 text-sm shrink-0">
                    <button onClick={() => toggle(c)} className="text-blue-600 font-medium">
                      {c.active ? "Slå fra" : "Slå til"}
                    </button>
                    <button onClick={() => remove(c)} className="text-red-600 font-medium">
                      Slet
                    </button>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
