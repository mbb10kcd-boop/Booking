"use client";

import { useEffect, useMemo, useState } from "react";
import { addDays, localISODate, nowLocalDateTimeString } from "@/lib/date";
import { capitalizeDaDate } from "@/lib/ai/messages";

/**
 * Dag- og tidsvælger til foreningsportalen (samme idé som i den private
 * portal, /book/privat): en stribe af dage, og for den valgte dag en række
 * tidsknapper hvor ledige tider er grønne og optagne grå. ALLE optaget-tider
 * for de næste ~30 dage hentes i ét kald (/api/portal/slots), så skift af dag
 * og varighed sker lynhurtigt i browseren uden "Tjek ledighed"-knap.
 *
 * En tid er kun ledig, hvis ALLE de valgte faciliteter er ledige (foreninger
 * kan vælge flere faciliteter på én gang). Optagne tider kan kun vælges, hvis
 * `allowRequests` er slået til og brugeren har valgt "send en anmodning" - så
 * bliver de gule, og forælderen får `occupied: true` og kan sende en anmodning
 * om aflysning/flytning i stedet for en booking.
 */

export type SlotSelection = { date: string; startTime: string; endTime: string; occupied: boolean };

type BusyMap = Record<string, [string, string][]>;

const DAY_START_HOUR = 7;
const DAY_END_HOUR = 23;
const WINDOW_DAYS = 30;
const STRIP_DAYS = 14;
const DEFAULT_DURATIONS = [
  { minutes: 60, label: "1 time" },
  { minutes: 90, label: "1½ time" },
  { minutes: 120, label: "2 timer" },
  { minutes: 180, label: "3 timer" },
];

function hhmm(totalMinutes: number): string {
  return `${String(Math.floor(totalMinutes / 60)).padStart(2, "0")}:${String(totalMinutes % 60).padStart(2, "0")}`;
}
function toMinutes(t: string): number {
  return Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
}
function freeIds(ids: string[], busy: BusyMap, start: string, end: string): string[] {
  return ids.filter((id) => !(busy[id] ?? []).some(([bs, be]) => bs < end && start < be));
}
function longDate(d: string): string {
  return capitalizeDaDate(new Date(`${d}T00:00:00`).toLocaleDateString("da-DK", { weekday: "long", day: "numeric", month: "long" }));
}

export function SlotPicker({
  facilityIds,
  audience,
  allowRequests = false,
  durations = DEFAULT_DURATIONS,
  onChange,
}: {
  facilityIds: string[];
  audience: "privat" | "forening";
  allowRequests?: boolean;
  durations?: { minutes: number; label: string }[];
  onChange: (selection: SlotSelection | null) => void;
}) {
  const [date, setDate] = useState(localISODate());
  const [duration, setDuration] = useState(durations[0]?.minutes ?? 60);
  const [pickedTime, setPickedTime] = useState<string | null>(null);
  const [requestMode, setRequestMode] = useState(false);
  const [customMode, setCustomMode] = useState(false);
  const [customStart, setCustomStart] = useState("18:00");
  const [customEnd, setCustomEnd] = useState("19:00");
  const [busyMap, setBusyMap] = useState<BusyMap>({});
  const [window_, setWindow] = useState<{ from: string; key: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);

  const key = facilityIds.join(",");

  async function load(fromDate: string) {
    if (facilityIds.length === 0) return;
    setLoading(true);
    setLoadError(false);
    try {
      const res = await fetch(`/api/portal/slots?facilityIds=${key}&from=${fromDate}&days=${WINDOW_DAYS}&audience=${audience}`);
      if (!res.ok) throw new Error("fejl");
      const data = await res.json();
      setBusyMap(data.busy ?? {});
      setWindow({ from: fromDate, key });
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    queueMicrotask(() => load(localISODate()));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const covers = (d: string) =>
    !!window_ &&
    window_.key === key &&
    d >= window_.from &&
    d < localISODate(addDays(new Date(`${window_.from}T00:00:00`), WINDOW_DAYS));

  function chooseDate(d: string) {
    if (!d) return;
    setDate(d);
    setPickedTime(null);
    if (!covers(d)) load(d);
  }

  function slotsOn(dayStr: string) {
    const nowStr = nowLocalDateTimeString();
    const result: { time: string; end: string; free: string[]; past: boolean }[] = [];
    for (let m = DAY_START_HOUR * 60; m + duration <= DAY_END_HOUR * 60; m += 30) {
      const time = hhmm(m);
      const end = hhmm(m + duration);
      result.push({
        time,
        end,
        free: freeIds(facilityIds, busyMap, `${dayStr}T${time}`, `${dayStr}T${end}`),
        past: `${dayStr}T${time}:00` <= nowStr,
      });
    }
    return result;
  }

  const ready = covers(date);
  const daySlots = useMemo(
    () => (ready ? slotsOn(date) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ready, date, duration, busyMap, key]
  );
  const isFull = (free: string[]) => free.length === facilityIds.length;

  const strip = useMemo(
    () =>
      Array.from({ length: STRIP_DAYS }, (_, i) => {
        const dayStr = localISODate(addDays(new Date(`${localISODate()}T00:00:00`), i));
        return { dayStr, anyFree: covers(dayStr) ? slotsOn(dayStr).some((s) => !s.past && isFull(s.free)) : null };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [window_, busyMap, duration, key]
  );

  // Det aktuelle valg (rent beregnet) - meldes videre til forælderen.
  const selection: SlotSelection | null = useMemo(() => {
    if (!ready) return null;
    if (customMode) {
      if (!customStart || !customEnd || customEnd <= customStart) return null;
      if (`${date}T${customStart}:00` <= nowLocalDateTimeString()) return null;
      const free = freeIds(facilityIds, busyMap, `${date}T${customStart}`, `${date}T${customEnd}`);
      const occupied = !isFull(free);
      if (occupied && !(allowRequests && requestMode)) return null;
      return { date, startTime: customStart, endTime: customEnd, occupied };
    }
    const slot = pickedTime ? daySlots.find((s) => s.time === pickedTime) : undefined;
    if (!slot || slot.past) return null;
    const occupied = !isFull(slot.free);
    if (occupied && !(allowRequests && requestMode)) return null;
    return { date, startTime: slot.time, endTime: slot.end, occupied };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, customMode, customStart, customEnd, date, busyMap, pickedTime, daySlots, allowRequests, requestMode, key]);

  const selKey = selection ? `${selection.date}|${selection.startTime}|${selection.endTime}|${selection.occupied}` : "";
  useEffect(() => {
    onChange(selection);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selKey]);

  const anyFreeToday = daySlots.some((s) => !s.past && isFull(s.free));
  const nextFree = strip.find((d) => d.dayStr > date && d.anyFree);

  return (
    <div className="space-y-5">
      <div>
        <div className="text-sm font-medium text-slate-700 mb-2">Hvor længe?</div>
        <div className="grid grid-cols-4 gap-2">
          {durations.map((d) => (
            <button
              key={d.minutes}
              onClick={() => {
                setDuration(d.minutes);
                setPickedTime(null);
                setCustomMode(false);
              }}
              className={`rounded-xl border py-2 text-xs sm:text-sm font-medium ${
                !customMode && duration === d.minutes
                  ? "border-blue-500 bg-blue-50 text-blue-700"
                  : "border-slate-200 text-slate-600 hover:border-slate-300"
              }`}
            >
              {d.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <div className="text-sm font-medium text-slate-700 mb-2">Dag</div>
        <div className="flex gap-2 overflow-x-auto pb-2 -mx-1 px-1">
          {strip.map(({ dayStr, anyFree }) => {
            const d = new Date(`${dayStr}T00:00:00`);
            const sel = dayStr === date;
            return (
              <button
                key={dayStr}
                onClick={() => chooseDate(dayStr)}
                className={`shrink-0 w-16 rounded-xl border py-2 text-center ${
                  sel
                    ? "border-blue-600 bg-blue-600 text-white"
                    : anyFree === false
                      ? "border-slate-200 bg-slate-50 text-slate-400"
                      : "border-slate-200 text-slate-700 hover:border-slate-300"
                }`}
              >
                <div className="text-[11px] uppercase tracking-wide opacity-80">
                  {dayStr === localISODate() ? "I dag" : d.toLocaleDateString("da-DK", { weekday: "short" }).replace(".", "")}
                </div>
                <div className="text-lg font-semibold leading-tight">{d.getDate()}</div>
                <div className="text-[11px] opacity-80">{d.toLocaleDateString("da-DK", { month: "short" }).replace(".", "")}</div>
                <div
                  className={`mx-auto mt-1 h-1.5 w-1.5 rounded-full ${
                    anyFree === null ? "bg-slate-300" : anyFree ? (sel ? "bg-white" : "bg-emerald-500") : sel ? "bg-white/50" : "bg-slate-300"
                  }`}
                />
              </button>
            );
          })}
        </div>
        <label className="mt-1 flex items-center gap-2 text-sm text-slate-500">
          Anden dato:
          <input
            type="date"
            min={localISODate()}
            value={date}
            onChange={(e) => chooseDate(e.target.value)}
            className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm text-slate-700"
          />
        </label>
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <div className="text-sm font-medium text-slate-700">{longDate(date)}</div>
          <button
            onClick={() => {
              setCustomMode((v) => !v);
              setPickedTime(null);
            }}
            className="text-xs text-blue-700 underline"
          >
            {customMode ? "Vælg fra tidsliste" : "Andre klokkeslæt"}
          </button>
        </div>

        {loadError ? (
          <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
            Kunne ikke hente ledige tider.{" "}
            <button className="underline" onClick={() => load(localISODate())}>
              Prøv igen
            </button>
          </div>
        ) : !ready || loading ? (
          <div className="grid grid-cols-4 gap-2 animate-pulse">
            {Array.from({ length: 12 }, (_, i) => (
              <div key={i} className="h-11 rounded-lg bg-slate-100" />
            ))}
          </div>
        ) : customMode ? (
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-slate-500 mb-1">Fra</label>
                <input
                  type="time"
                  step={300}
                  value={customStart}
                  onChange={(e) => setCustomStart(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">Til</label>
                <input
                  type="time"
                  step={300}
                  value={customEnd}
                  onChange={(e) => setCustomEnd(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm"
                />
              </div>
            </div>
            {customStart && customEnd && customEnd > customStart ? (
              isFull(freeIds(facilityIds, busyMap, `${date}T${customStart}`, `${date}T${customEnd}`)) ? (
                <div className="rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-2.5 text-sm text-emerald-800">
                  Tiden er ledig
                  {facilityIds.length > 1 ? " i alle valgte faciliteter" : ""}.
                </div>
              ) : (
                <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-2.5 text-sm text-amber-800">
                  Tiden er optaget.
                  {allowRequests && !requestMode && (
                    <button className="block mt-1 underline" onClick={() => setRequestMode(true)}>
                      Send en anmodning om tiden i stedet
                    </button>
                  )}
                </div>
              )
            ) : (
              <div className="text-xs text-slate-400">Sluttidspunktet skal være efter starttidspunktet.</div>
            )}
          </div>
        ) : (
          <>
            {[
              { title: "Formiddag", from: 0, to: 12 * 60 },
              { title: "Eftermiddag", from: 12 * 60, to: 17 * 60 },
              { title: "Aften", from: 17 * 60, to: 24 * 60 },
            ].map((part) => {
              const inPart = daySlots.filter((s) => !s.past && toMinutes(s.time) >= part.from && toMinutes(s.time) < part.to);
              if (inPart.length === 0) return null;
              return (
                <div key={part.title} className="mb-3">
                  <div className="text-xs uppercase tracking-wide text-slate-400 mb-1.5">{part.title}</div>
                  <div className="grid grid-cols-4 gap-2">
                    {inPart.map((s) => {
                      const full = isFull(s.free);
                      const selectable = full || (allowRequests && requestMode);
                      const isPicked = pickedTime === s.time && !!selection;
                      return (
                        <button
                          key={s.time}
                          disabled={!selectable}
                          onClick={() => setPickedTime(s.time)}
                          className={`rounded-lg border py-2 text-center text-sm font-medium ${
                            isPicked
                              ? full
                                ? "border-blue-600 bg-blue-600 text-white"
                                : "border-amber-600 bg-amber-500 text-white"
                              : full
                                ? "border-emerald-200 bg-emerald-50 text-emerald-800 hover:border-emerald-400"
                                : selectable
                                  ? "border-amber-200 bg-amber-50 text-amber-800 hover:border-amber-400"
                                  : "border-slate-100 bg-slate-50 text-slate-300 line-through"
                          }`}
                        >
                          {s.time}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
            {!anyFreeToday && (
              <div className="rounded-xl bg-slate-50 border border-slate-200 px-4 py-3 text-sm text-slate-600">
                Der er ingen ledige tider denne dag{facilityIds.length > 1 ? " i alle de valgte faciliteter" : ""}.
                {nextFree && (
                  <button className="block mt-1 text-blue-700 font-medium underline" onClick={() => chooseDate(nextFree.dayStr)}>
                    Gå til næste dag med ledige tider
                  </button>
                )}
              </div>
            )}
          </>
        )}

        {allowRequests && ready && !loading && (
          <div className="mt-3 text-xs text-slate-500">
            {requestMode ? (
              <>
                Gule tider er optaget. Vælger I en af dem, sendes en <b>anmodning</b> til Grenaa Idrætscenter, som
                tager stilling til det.{" "}
                <button
                  className="underline text-blue-700"
                  onClick={() => {
                    setRequestMode(false);
                    setPickedTime(null);
                  }}
                >
                  Vis kun ledige tider
                </button>
              </>
            ) : (
              <>
                Kan I ikke finde en tid, der passer?{" "}
                <button className="underline text-blue-700" onClick={() => setRequestMode(true)}>
                  Send en anmodning om en optaget tid
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
