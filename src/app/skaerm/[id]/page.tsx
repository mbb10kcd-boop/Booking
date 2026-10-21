"use client";

import { useEffect, useMemo, useRef, useState, use as usePromise } from "react";
import { formatDaTime } from "@/lib/ai/messages";
import { nowLocalDateTimeString } from "@/lib/date";

interface FacilityBlock {
  facility: { id: string; name: string; color: string | null } | undefined;
  bookings: { id: string; title: string; startsAt: string; endsAt: string; timeLabel?: string }[];
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

// Alt indhold i blokkene er målt i "em", så hele skærmen kan skaleres ned i
// ét hug (via skriftstørrelsen på rutenettet), når en travl dag har mange
// bookinger - i stedet for at de nederste bookinger bliver skåret af.
// Tallene er pixels ved normal størrelse (16 px) og bruges kun til at regne
// ud, hvor meget der kan være på skærmen.
const PX = { padding: 48, head: 56, row: 72, empty: 44, more: 36, gap: 24 };
// Mindste skalering før vi i stedet viser et loft med en "+N flere i dag"-linje.
const MIN_SCALE = 0.6;
const MIN_VISIBLE = 3;

function blockHeight(total: number, cap: number): number {
  if (total === 0) return PX.padding + PX.head + PX.empty;
  const shown = Math.min(total, cap);
  return PX.padding + PX.head + shown * PX.row + (total > shown ? PX.more : 0);
}

/**
 * Finder den største skalering (højst 1), hvor alle rækker af faciliteter kan
 * være på skærmen på samme tid. Er selv MIN_SCALE ikke nok, sænkes antallet af
 * viste bookinger pr. facilitet (`cap`), indtil det kan være der.
 */
function fitLayout(blocks: FacilityBlock[], columns: number, availableHeight: number) {
  const rows: number[][] = [];
  blocks.forEach((b, i) => {
    const r = Math.floor(i / columns);
    (rows[r] ??= []).push(b.bookings.length);
  });
  const rowCount = Math.max(1, rows.length);
  const maxTotal = Math.max(0, ...blocks.map((b) => b.bookings.length));
  for (let cap = Math.max(maxTotal, MIN_VISIBLE); cap >= MIN_VISIBLE; cap--) {
    const rowHeights = rows.map((counts) => Math.max(...counts.map((n) => blockHeight(n, cap))));
    const needed = rowHeights.reduce((a, b) => a + b, 0) + PX.gap * (rowCount - 1);
    const scale = Math.min(1, availableHeight / needed);
    if (scale >= MIN_SCALE || cap === MIN_VISIBLE) {
      return { scale: Math.max(scale, Math.min(MIN_SCALE, 1)), cap, rowHeights };
    }
  }
  return { scale: 1, cap: maxTotal, rowHeights: rows.map(() => PX.padding + PX.head + PX.row) };
}

export default function InfoScreenPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = usePromise(params);
  const [data, setData] = useState<{ screen: { name: string }; byFacility: FacilityBlock[] } | null>(null);
  const [now, setNow] = useState(new Date());
  const [error, setError] = useState(false);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const [gridHeight, setGridHeight] = useState(600);
  // Finjustering oven på beregningen herunder: hvis noget alligevel løber ud over kanten, skrumpes alt lidt ad gangen.
  const [shrink, setShrink] = useState(1);

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

  // Måler den plads, der er til rådighed til blokkene (skærmhøjde minus overskrift), så indholdet kan tilpasses.
  const hasData = !!data;
  useEffect(() => {
    const el = gridRef.current;
    if (!el) return undefined;
    const measure = () => setGridHeight(el.clientHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [hasData]);

  const signature = `${(data?.byFacility ?? []).map((b) => b.bookings.length).join(",")}|${gridHeight}`;
  useEffect(() => {
    // Ny dag/nye bookinger/ny skærmstørrelse: start forfra med fuld størrelse.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setShrink(1);
  }, [signature]);
  useEffect(() => {
    const el = gridRef.current;
    if (!el || shrink < 0.4) return;
    const lists = el.querySelectorAll<HTMLElement>("[data-list]");
    if (Array.from(lists).some((l) => l.scrollHeight > l.clientHeight + 1)) setShrink((s) => s * 0.96);
  });

  const columns = useMemo(() => columnsFor(data?.byFacility.length ?? 0), [data?.byFacility.length]);
  const layout = useMemo(
    () => fitLayout(data?.byFacility ?? [], columns, gridHeight),
    [data?.byFacility, columns, gridHeight]
  );

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
        ref={gridRef}
        className="grid flex-1 min-h-0"
        style={{
          fontSize: `${16 * layout.scale * shrink}px`,
          gap: "1.5em",
          gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
          // Rækkerne får højde i forhold til hvor meget der er i dem, så en travl hal ikke bliver klippet af.
          gridTemplateRows: layout.rowHeights.map((h) => `minmax(0, ${h}fr)`).join(" "),
        }}
      >
        {data.byFacility.map((block) => {
          const visible = block.bookings.slice(0, layout.cap);
          const overflow = block.bookings.length - visible.length;
          return (
            <div
              key={block.facility?.id ?? Math.random()}
              className="rounded-[1.5em] bg-slate-900 border border-slate-800 p-[1.5em] flex flex-col min-h-0"
            >
              <div className="flex items-center gap-[0.75em] mb-[1em] shrink-0">
                <span
                  className="w-[1em] h-[1em] rounded-full shrink-0"
                  style={{ backgroundColor: block.facility?.color ?? "#64748b" }}
                />
                <h2 className="text-[1.75em] leading-tight font-semibold uppercase tracking-wide truncate">
                  {block.facility?.name ?? "Ukendt"}
                </h2>
              </div>
              <div data-list className="flex flex-col gap-[0.75em] flex-1 min-h-0 overflow-hidden">
                {block.bookings.length === 0 && <div className="text-slate-500 text-[1.25em]">Ledig hele dagen</div>}
                {visible.map((b) => {
                  const nowStr = nowLocalDateTimeString(now);
                  const isNow = b.startsAt <= nowStr && nowStr <= b.endsAt;
                  return (
                    <div
                      key={b.id}
                      className={`rounded-[1em] px-[1.25em] py-[0.9em] flex items-center justify-between text-[1.25em] leading-snug ${
                        isNow ? "bg-blue-600" : "bg-slate-800"
                      }`}
                    >
                      <span className="font-medium truncate pr-[1em]">{b.title}</span>
                      <span className="font-mono tabular-nums shrink-0">
                        {b.timeLabel && b.timeLabel.includes(" ") ? b.timeLabel : `${formatDaTime(b.startsAt)} - ${formatDaTime(b.endsAt)}`}
                      </span>
                    </div>
                  );
                })}
                {overflow > 0 && <div className="text-slate-400 text-[1.1em] px-[0.25em]">+{overflow} flere i dag</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
