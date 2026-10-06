import type { Metadata } from "next";
import { loadCancelList } from "@/lib/cancelList";
import { weekdayName } from "@/lib/statusLabels";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Aflysninger - Grenaa Idrætscenter", robots: { index: true } };

const fmtDate = (d: string) => {
  const [, m, day] = d.split("-").map(Number);
  return `${day}/${m}`;
};
const fmtTime = (t: string) => t.replace(":", ".");

/**
 * Offentlig aflysningsliste til hjemmesiden - ingen login, opdateres
 * automatisk ud fra bookingsystemet. Kan indlejres som iframe:
 *   /aflysninger                -> alle haller
 *   /aflysninger?hal=Opvisning  -> kun haller hvis navn indeholder teksten
 *   &titel=nej                  -> uden overskrift (hvis siden har sin egen)
 */
export default async function AflysningerPage({
  searchParams,
}: {
  searchParams: Promise<{ hal?: string; titel?: string }>;
}) {
  const { hal, titel } = await searchParams;
  const all = await loadCancelList();
  const items = hal ? all.filter((r) => r.hall.toLowerCase().includes(hal.toLowerCase())) : all;

  const byHall = new Map<string, typeof items>();
  for (const r of items) {
    const list = byHall.get(r.hall) ?? [];
    list.push(r);
    byHall.set(r.hall, list);
  }
  const halls = Array.from(byHall.keys()).sort((a, b) => a.localeCompare(b, "da"));

  return (
    <div className="min-h-screen bg-white px-2 py-3 text-slate-900">
      <div className="mx-auto max-w-4xl">
        {titel !== "nej" && <h1 className="mb-3 text-xl font-bold">Aflysninger</h1>}
        {halls.length === 0 ? (
          <p className="text-sm text-slate-600">Der er ingen aflysninger lige nu.</p>
        ) : (
          halls.map((h) => (
            <section key={h} className="mb-6">
              <h2 className="mb-1 text-lg font-bold">{h}</h2>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <tbody>
                    {byHall.get(h)!.map((r) => {
                      const weekday = weekdayName(new Date(`${r.date}T00:00:00`).getDay());
                      return (
                        <tr key={r.id} className="border-b border-slate-200 align-top">
                          <td className="py-2 pr-3 whitespace-nowrap">{weekday}</td>
                          <td className="py-2 pr-3 whitespace-nowrap">{fmtDate(r.date)}</td>
                          <td className="py-2 pr-3 whitespace-nowrap">
                            {r.startTime === "00:00" && r.endTime >= "23:59"
                              ? "Hele dagen"
                              : `${fmtTime(r.startTime)}-${fmtTime(r.endTime)}`}
                          </td>
                          <td className="py-2">
                            <span className="font-medium">{r.reason ?? r.who}</span>
                            {r.reason && r.who && <span className="text-slate-500"> – aflyst: {r.who}</span>}
                            {r.facility !== r.hall && <span className="text-slate-500"> ({r.facility})</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          ))
        )}
      </div>
    </div>
  );
}
