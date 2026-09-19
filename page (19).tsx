"use client";

import { useEffect, useState, use as usePromise } from "react";
import { formatDaTime } from "@/lib/ai/messages";
import { nowLocalDateTimeString } from "@/lib/date";

interface FacilityBlock {
  facility: { id: string; name: string; color: string | null } | undefined;
  bookings: { id: string; title: string; startsAt: string; endsAt: string }[];
}

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
    <div className="min-h-screen bg-slate-950 text-white p-8 md:p-12 flex flex-col">
      <div className="flex items-center justify-between mb-8">
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

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 flex-1">
        {data.byFacility.map((block) => (
          <div key={block.facility?.id ?? Math.random()} className="rounded-3xl bg-slate-900 border border-slate-800 p-6 flex flex-col">
            <div className="flex items-center gap-3 mb-4">
              <span className="w-4 h-4 rounded-full" style={{ backgroundColor: block.facility?.color ?? "#64748b" }} />
              <h2 className="text-2xl md:text-3xl font-semibold uppercase tracking-wide">{block.facility?.name ?? "Ukendt"}</h2>
            </div>
            <div className="space-y-3 flex-1">
              {block.bookings.length === 0 && <div className="text-slate-500 text-xl">Ledig hele dagen</div>}
              {block.bookings.map((b) => {
                const nowStr = nowLocalDateTimeString(now);
                const isNow = b.startsAt <= nowStr && nowStr <= b.endsAt;
                return (
                  <div
                    key={b.id}
                    className={`rounded-2xl px-5 py-4 flex items-center justify-between ${
                      isNow ? "bg-blue-600" : "bg-slate-800"
                    }`}
                  >
                    <span className="text-xl font-medium">{b.title}</span>
                    <span className="text-xl font-mono tabular-nums">
                      {formatDaTime(b.startsAt)} - {formatDaTime(b.endsAt)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
