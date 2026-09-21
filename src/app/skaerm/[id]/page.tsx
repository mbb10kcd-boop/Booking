"use client";

import { useEffect, useMemo, useState, use as usePromise } from "react";
import { formatDaTime } from "@/lib/ai/messages";
import { nowLocalDateTimeString } from "@/lib/date";

interface FacilityBlock {
  facility: { id: string; name: string; color: string | null } | undefined;
  bookings: { id: string; title: string; startsAt: string; endsAt: string }[];
}

// Skærmene hænger fast og kan ikke scrolles (Martin), så antallet af
// synlige kolonner skal vokse med antallet af faciliteter i stedet for at
// stable dem i flere rækker, der løber ud over skærmen. Antallet af blokke
// er nu normalt lavt (de faste haller + kun de lokaler der er booket i dag),
// men denne skalering er en sikkerhed hvis der en dag skulle være flere.
function columnsFor(count: number): number {
  if (count <= 1) return 1;
  if (count <= 4) return 2;
  if (count <= 6) return 3;
  return 4;
}

// Samme tankegang for antal viste bookinger pr. facilitet: på en travl dag
// skal en enkelt facilitet ikke kunne skubbe resten af skærmen ud over
// kanten - i stedet vises et loft med en "+N flere i dag"-linje.
const MAX_BOOKINGS_PER_BLOCK = 6;

export default function InfoScreenPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = usePromise(params);
  const [data, setData] = useState<{ screen: { name: string }; byFacility: FacilityBlock[] } | null>(null);
  const [now, setNow] = useState(new Date());
  const [error, setError] = useState(false);

  async function load() {
    try {
      const res = await fetch(`/api/screens/${id}`);
      if (!res.ok) {
        setError(true);
        return;
      }
      setData(await res.json());
      setError(false);
    } catch {
      setError(true);
    }
  }

  useEffect(() => {
    load();
    const dataInterval = setInterval(load, 30000);
    const clockInterval = setInterval(() => setNow(new Date()), 1000);
    return () => {
      clearInterval(dataInterval);
      clearInterval(clockInterval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const columns = useMemo(() => columnsFor(data?.byFacility.length ?? 0), [data?.byFacility.length]);

  if (error) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center text-2xl">
        Skærm ikke fundet.
      </div>
    );
  }

  if (!data) {
    return <div className="min-h-screen bg-slate-950" />;
  }

  return (
    <div className="h-screen overflow-hidden bg-slate-950 text-white p-8 md:p-12 flex flex-col">
      <div className="flex items-center justify-between mb-8 shrink-0">
        <div>
          <div className="text-blue-400 text-lg font-medium">Grenaa Idrætscenter</div>
          <h1 className="text-4xl md:text-5xl font-bold">I DAG</h1>
        </div>
        <div className="text-right">
          <div className="text-5xl font-mono font-semibold tabular-nums">
            {now.toLocaleTimeString("da-DK", { hour: "2-digit", minute: "2-digit" })}
          </div>
          <div className="text-slate-400 text-lg capitalize">
            {now.toLocaleDateString("da-DK", { weekday: "long", day: "2-digit", month: "long" })}
          </div>
        </div>
      </div>

      <div
        className="grid gap-6 flex-1 min-h-0"
        style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gridAutoRows: "1fr" }}
      >
        {data.byFacility.map((block) => {
          const visible = block.bookings.slice(0, MAX_BOOKINGS_PER_BLOCK);
          const overflow = block.bookings.length - visible.length;
          return (
            <div
              key={block.facility?.id ?? Math.random()}
              className="rounded-3xl bg-slate-900 border border-slate-800 p-6 flex flex-col min-h-0"
            >
              <div className="flex items-center gap-3 mb-4 shrink-0">
                <span className="w-4 h-4 rounded-full shrink-0" style={{ backgroundColor: block.facility?.color ?? "#64748b" }} />
                <h2 className="text-2xl md:text-3xl font-semibold uppercase tracking-wide truncate">{block.facility?.name ?? "Ukendt"}</h2>
              </div>
              <div className="space-y-3 flex-1 min-h-0 overflow-hidden">
                {block.bookings.length === 0 && <div className="text-slate-500 text-xl">Ledig hele dagen</div>}
                {visible.map((b) => {
                  const nowStr = nowLocalDateTimeString(now);
                  const isNow = b.startsAt <= nowStr && nowStr <= b.endsAt;
                  return (
                    <div
                      key={b.id}
                      className={`rounded-2xl px-5 py-4 flex items-center justify-between ${
                        isNow ? "bg-blue-600" : "bg-slate-800"
                      }`}
                    >
                      <span className="text-xl font-medium truncate pr-4">{b.title}</span>
                      <span className="text-xl font-mono tabular-nums shrink-0">
                        {formatDaTime(b.startsAt)} - {formatDaTime(b.endsAt)}
                      </span>
                    </div>
                  );
                })}
                {overflow > 0 && <div className="text-slate-400 text-lg px-1">+{overflow} flere i dag</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
