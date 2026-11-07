"use client";

import { useCallback, useEffect, useState } from "react";

type Row = {
  action: "NY BOOKING" | "FLYTNING" | "AFLYSNING";
  facility: string;
  organization: string;
  title: string;
  weekday: string;
  fromTime: string;
  toTime: string;
  firstDate: string;
  lastDate: string;
  count: number;
  hours: number;
  dates: string[];
  previous: string;
  note: string;
  source: string;
};

type ExportRow = {
  id: string;
  createdAt: string | null;
  createdBy: string | null;
  newCount: number | null;
  movedCount: number | null;
  cancelledCount: number | null;
};

type Data = {
  baseline: string;
  counts: { new: number; moved: number; cancelled: number };
  rows: Row[];
  exports: ExportRow[];
};

const ACTION_STYLE: Record<Row["action"], string> = {
  "NY BOOKING": "bg-emerald-100 text-emerald-800",
  FLYTNING: "bg-amber-100 text-amber-800",
  AFLYSNING: "bg-red-100 text-red-800",
};

function fmtUtc(s: string | null): string {
  if (!s) return "";
  const d = new Date(s.replace(" ", "T") + "Z");
  return d.toLocaleString("da-DK", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Copenhagen" });
}

export function WinkasLogClient() {
  const [data, setData] = useState<Data | null>(null);
  const [includeAll, setIncludeAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [baselineDate, setBaselineDate] = useState("");

  const load = useCallback(async () => {
    const res = await fetch(`/api/winkas-log${includeAll ? "?includeAll=1" : ""}`, { cache: "no-store" });
    if (res.ok) setData(await res.json());
    else setError("Kunne ikke hente loggen.");
  }, [includeAll]);

  useEffect(() => {
    queueMicrotask(load);
  }, [load]);

  async function download(res: Response, fallbackName: string) {
    const blob = await res.blob();
    const cd = res.headers.get("Content-Disposition") ?? "";
    const m = cd.match(/filename="([^"]+)"/);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = m ? m[1] : fallbackName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  async function exportAndMark() {
    setBusy(true);
    setError(null);
    setMessage(null);
    const res = await fetch("/api/winkas-log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "export", includeAll }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setError(j.error ?? "Noget gik galt.");
    } else {
      await download(res, "winkas-log.csv");
      setMessage("Filen er hentet, og bookingerne er markeret som overført til Winkas. Du kan hente den igen nederst på siden.");
      await load();
    }
    setBusy(false);
  }

  async function previewCsv() {
    const res = await fetch(`/api/winkas-log?format=csv${includeAll ? "&includeAll=1" : ""}`);
    if (res.ok) await download(res, "winkas-log-eksempel.csv");
  }

  async function saveBaseline() {
    if (!baselineDate) return;
    setBusy(true);
    const res = await fetch("/api/winkas-log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "baseline", date: baselineDate }),
    });
    setBusy(false);
    if (res.ok) {
      setMessage("Startdato gemt.");
      await load();
    } else setError("Ugyldig dato.");
  }

  const total = data ? data.counts.new + data.counts.moved + data.counts.cancelled : 0;

  return (
    <div className="px-4 md:px-8 py-6 space-y-6 max-w-6xl">
      <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600 space-y-1">
        <p>
          Her ser du, hvad der skal bookes, flyttes eller aflyses i Winkas, fordi det er sket i bookingsystemet siden sidste
          log. Bookinger der selv stammer fra Winkas (mails fra kommunen og import) er som standard ikke med.
        </p>
        <p>
          <strong>Hent log</strong> giver en fil, der åbner i Excel, og markerer samtidig det hele som overført - så næste
          log kun viser det nye. Mangler en booking i filen, er den ikke oprettet efter startdatoen nedenfor.
        </p>
      </div>

      {error && <div className="rounded-lg bg-red-50 text-red-700 text-sm px-3 py-2">{error}</div>}
      {message && <div className="rounded-lg bg-emerald-50 text-emerald-800 text-sm px-3 py-2">{message}</div>}

      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={exportAndMark}
          disabled={busy || !data || total === 0}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-40"
        >
          Hent log og markér som overført
        </button>
        <button
          onClick={previewCsv}
          disabled={!data || total === 0}
          className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
        >
          Hent uden at markere
        </button>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={includeAll} onChange={(e) => setIncludeAll(e.target.checked)} />
          Tag også bookinger med fra Winkas-mails og import
        </label>
      </div>

      {data && (
        <div className="flex flex-wrap gap-3 text-sm">
          <span className="rounded-full bg-emerald-100 px-3 py-1 font-semibold text-emerald-800">{data.counts.new} nye</span>
          <span className="rounded-full bg-amber-100 px-3 py-1 font-semibold text-amber-800">{data.counts.moved} flyttede</span>
          <span className="rounded-full bg-red-100 px-3 py-1 font-semibold text-red-800">{data.counts.cancelled} aflyste</span>
          <span className="text-slate-500 self-center">Leder efter nye bookinger oprettet efter {fmtUtc(data.baseline)}</span>
        </div>
      )}

      {data && data.rows.length === 0 && (
        <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-slate-400">
          Intet nyt siden sidste log.
        </div>
      )}

      {data && data.rows.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2">Handling</th>
                <th className="px-3 py-2">Facilitet</th>
                <th className="px-3 py-2">Forening / titel</th>
                <th className="px-3 py-2">Tid</th>
                <th className="px-3 py-2">Datoer</th>
                <th className="px-3 py-2 text-right">Timer</th>
                <th className="px-3 py-2">Bemærkning</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r, i) => (
                <tr key={i} className="border-t border-slate-100 align-top">
                  <td className="px-3 py-2">
                    <span className={`rounded px-2 py-0.5 text-xs font-bold ${ACTION_STYLE[r.action]}`}>{r.action}</span>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">{r.facility}</td>
                  <td className="px-3 py-2">
                    <div className="font-medium text-slate-800">{r.organization || r.title}</div>
                    {r.organization && r.title && r.title !== r.organization && <div className="text-xs text-slate-500">{r.title}</div>}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {r.weekday} {r.fromTime}–{r.toTime}
                  </td>
                  <td className="px-3 py-2">
                    {r.count === 1 ? (
                      r.firstDate
                    ) : (
                      <span title={r.dates.join(", ")}>
                        {r.firstDate} – {r.lastDate} ({r.count} gange)
                      </span>
                    )}
                    {r.previous && <div className="text-xs text-slate-500">Før: {r.previous}</div>}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{String(r.hours).replace(".", ",")}</td>
                  <td className="px-3 py-2 text-xs text-slate-500">{[r.source, r.note].filter(Boolean).join(" · ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-2">
        <h2 className="text-sm font-semibold text-slate-800">Startdato for loggen</h2>
        <p className="text-sm text-slate-500">
          Bookinger oprettet før denne dato kommer ikke med. Vil du have ældre bookinger med, så vælg en tidligere dato.
        </p>
        <div className="flex items-center gap-2">
          <input type="date" value={baselineDate} onChange={(e) => setBaselineDate(e.target.value)} className="rounded border border-slate-300 px-2 py-1 text-sm" />
          <button onClick={saveBaseline} disabled={!baselineDate || busy} className="rounded-lg border border-slate-300 px-3 py-1 text-sm hover:bg-slate-50 disabled:opacity-40">
            Gem
          </button>
        </div>
      </div>

      {data && data.exports.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="mb-2 text-sm font-semibold text-slate-800">Tidligere logs</h2>
          <ul className="divide-y divide-slate-100 text-sm">
            {data.exports.map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-3 py-1.5">
                <span>
                  {fmtUtc(e.createdAt)} · {e.createdBy ?? ""} · {e.newCount ?? 0} nye, {e.movedCount ?? 0} flyttede, {e.cancelledCount ?? 0} aflyste
                </span>
                <a href={`/api/winkas-log/exports/${e.id}`} className="text-blue-600 hover:underline">
                  Hent igen
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
