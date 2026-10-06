"use client";

import { useEffect, useMemo, useState } from "react";
import type { BookingDTO, FacilityDTO } from "@/lib/clientTypes";
import { formatDaDate, formatDaTime, capitalizeDaDate } from "@/lib/ai/messages";
import { combineDateAndTime, localISODate, addDays, nowLocalDateTimeString } from "@/lib/date";

type Step = "facilitet" | "tid" | "info" | "betaling" | "kvittering";

/**
 * Enten én bestemt facilitet (som hidtil), eller en GRUPPE af indbyrdes
 * ombyttelige faciliteter (fx pickleball-/badmintonbanerne, se
 * bookableGroupLabel i src/db/schema.ts) - her vælger gæsten kun et ANTAL,
 * og systemet finder selv ud af hvilke konkrete baner der er ledige, i
 * stedet for at gæsten skal klikke sig igennem banerne én for én for at se
 * hvilken der er fri (Martin).
 */
type Selection =
  | { kind: "single"; facility: FacilityDTO }
  | { kind: "group"; label: string; members: FacilityDTO[] };

const DAY_START_HOUR = 7;
const DAY_END_HOUR = 23;
const SLOT_WINDOW_DAYS = 30;
const DAY_STRIP_DAYS = 14;
const DURATIONS = [
  { minutes: 60, label: "1 time" },
  { minutes: 90, label: "1½ time" },
  { minutes: 120, label: "2 timer" },
];

function hhmm(totalMinutes: number): string {
  return `${String(Math.floor(totalMinutes / 60)).padStart(2, "0")}:${String(totalMinutes % 60).padStart(2, "0")}`;
}

type BusyMap = Record<string, [string, string][]>;

/** Ledige faciliteter (id'er) for et tidsrum "YYYY-MM-DDTHH:mm" - ren funktion over de allerede hentede optaget-tider. */
function freeFacilityIds(facilityIds: string[], busy: BusyMap, start: string, end: string): string[] {
  return facilityIds.filter((id) => !(busy[id] ?? []).some(([bs, be]) => bs < end && start < be));
}

export default function PublicBookingPortal() {
  const [facilities, setFacilities] = useState<FacilityDTO[]>([]);
  const [step, setStep] = useState<Step>("facilitet");
  const [selection, setSelection] = useState<Selection | null>(null);
  const [groupCount, setGroupCount] = useState(1);
  const [date, setDate] = useState(localISODate());
  const [duration, setDuration] = useState(60);
  const [pickedTime, setPickedTime] = useState<string | null>(null);
  const [busyMap, setBusyMap] = useState<BusyMap>({});
  const [slotWindow, setSlotWindow] = useState<{ from: string; key: string } | null>(null);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [slotsError, setSlotsError] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [bookings, setBookings] = useState<BookingDTO[]>([]);
  const [paymentId, setPaymentId] = useState<string | null>(null);
  const [accessCode, setAccessCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/facilities")
      .then((r) => r.json())
      .then((data) => setFacilities(data.filter((f: FacilityDTO) => !f.archived && !f.hiddenFromPrivatePortal)));
  }, []);

  // Faciliteter uden en bookableGroupLabel vises hver for sig som hidtil;
  // faciliteter der DELER samme (ikke-tomme) label samles i stedet i ét
  // valgbart "gruppe"-kort, med gæstens ønskede antal som eneste ekstra valg.
  const listItems = useMemo(() => {
    const items: Array<{ type: "facility"; facility: FacilityDTO } | { type: "group"; label: string; members: FacilityDTO[] }> = [];
    const seenGroups = new Set<string>();
    for (const f of facilities) {
      if (f.bookableGroupLabel) {
        if (seenGroups.has(f.bookableGroupLabel)) continue;
        seenGroups.add(f.bookableGroupLabel);
        items.push({
          type: "group",
          label: f.bookableGroupLabel,
          members: facilities.filter((m) => m.bookableGroupLabel === f.bookableGroupLabel),
        });
      } else {
        items.push({ type: "facility", facility: f });
      }
    }
    return items;
  }, [facilities]);

  const isGroup = selection?.kind === "group";
  const groupMembers = selection?.kind === "group" ? selection.members : [];
  const referenceFacility = selection?.kind === "single" ? selection.facility : groupMembers[0];

  function selectSingle(facility: FacilityDTO) {
    setSelection({ kind: "single", facility });
  }
  function selectGroup(label: string, members: FacilityDTO[]) {
    setSelection({ kind: "group", label, members });
    setGroupCount(1);
  }

  const slotFacilityIds = useMemo(
    () => (selection ? (selection.kind === "single" ? [selection.facility.id] : selection.members.map((m) => m.id)) : []),
    [selection]
  );
  const slotFacilityKey = slotFacilityIds.join(",");
  const need = selection?.kind === "group" ? groupCount : 1;

  /**
   * Henter ALLE optaget-tider for de valgte faciliteter de næste ~30 dage i ét
   * kald, så dag- og tidsvalget herefter sker lynhurtigt i browseren uden at
   * spørge serveren om hvert enkelt tidspunkt. Det endelige, autoritative
   * konflikttjek sker stadig ved selve bookingen (se submitBooking).
   */
  async function loadSlots(fromDate: string) {
    if (slotFacilityIds.length === 0) return;
    setLoadingSlots(true);
    setSlotsError(false);
    try {
      const res = await fetch(`/api/portal/slots?facilityIds=${slotFacilityKey}&from=${fromDate}&days=${SLOT_WINDOW_DAYS}`);
      if (!res.ok) throw new Error("fejl");
      const data = await res.json();
      setBusyMap(data.busy ?? {});
      setSlotWindow({ from: fromDate, key: slotFacilityKey });
    } catch {
      setSlotsError(true);
    } finally {
      setLoadingSlots(false);
    }
  }

  // Hent ledigheden så snart man har valgt hvad man vil booke (allerede mens man
  // stadig er på første trin), så den er klar når man kommer til tidsvalget.
  useEffect(() => {
    if (selection && (step === "facilitet" || step === "tid")) {
      const today = localISODate();
      const far = date >= localISODate(addDays(new Date(`${today}T00:00:00`), SLOT_WINDOW_DAYS));
      // Udskudt, så hentningen (som sætter state) ikke kører synkront i selve effekten.
      queueMicrotask(() => loadSlots(far ? date : today));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slotFacilityKey, step === "tid"]);

  const windowCoversDate = (d: string) =>
    !!slotWindow &&
    slotWindow.key === slotFacilityKey &&
    d >= slotWindow.from &&
    d < localISODate(addDays(new Date(`${slotWindow.from}T00:00:00`), SLOT_WINDOW_DAYS));

  function chooseDate(d: string) {
    if (!d) return;
    setDate(d);
    setPickedTime(null);
    if (!windowCoversDate(d)) loadSlots(d);
  }

  /** Alle mulige starttidspunkter på en dag for den valgte varighed, med hvilke faciliteter der er ledige. */
  function slotsOnDay(dayStr: string) {
    const nowStr = nowLocalDateTimeString();
    const result: { time: string; end: string; free: string[]; past: boolean }[] = [];
    for (let m = DAY_START_HOUR * 60; m + duration <= DAY_END_HOUR * 60; m += 30) {
      const time = hhmm(m);
      const end = hhmm(m + duration);
      result.push({
        time,
        end,
        free: freeFacilityIds(slotFacilityIds, busyMap, `${dayStr}T${time}`, `${dayStr}T${end}`),
        past: `${dayStr}T${time}:00` <= nowStr,
      });
    }
    return result;
  }

  const slotsReady = windowCoversDate(date);
  const daySlots = useMemo(
    () => (slotsReady ? slotsOnDay(date) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [slotsReady, date, duration, busyMap, slotFacilityKey]
  );
  const picked = pickedTime ? daySlots.find((s) => s.time === pickedTime) : undefined;
  const pickedOk = !!picked && !picked.past && picked.free.length >= need;
  const startTime = pickedOk ? picked!.time : "";
  const endTime = pickedOk ? picked!.end : "";
  const resolvedFacilityIds = pickedOk ? picked!.free.slice(0, need) : [];

  const dayStrip = useMemo(
    () =>
      Array.from({ length: DAY_STRIP_DAYS }, (_, i) => {
        const dayStr = localISODate(addDays(new Date(`${localISODate()}T00:00:00`), i));
        const anyFree =
          windowCoversDate(dayStr) ? slotsOnDay(dayStr).some((s) => !s.past && s.free.length >= need) : null;
        return { dayStr, anyFree };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [slotWindow, busyMap, duration, need, slotFacilityKey]
  );

  async function submitBooking() {
    if (!selection) return;
    setBusy(true);
    setError(null);
    const startsAt = combineDateAndTime(date, startTime);
    const endsAt = combineDateAndTime(date, endTime);

    const res = await fetch(selection.kind === "single" ? "/api/portal/book" : "/api/portal/book-group", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        selection.kind === "single"
          ? { facilityId: selection.facility.id, startsAt, endsAt, name, email, phone }
          : { facilityIds: resolvedFacilityIds, startsAt, endsAt, name, email, phone }
      ),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) {
      setError(data.error ?? "Der opstod en fejl.");
      if (res.status === 409) {
        // Tiden blev optaget i mellemtiden - gå tilbage til tidsvalget med frisk ledighed.
        setPickedTime(null);
        setStep("tid");
        loadSlots(localISODate());
      }
      return;
    }
    const createdBookings: BookingDTO[] = data.bookings ?? (data.booking ? [data.booking] : []);
    setBookings(createdBookings);
    if (data.requiresPayment) {
      setPaymentId(data.paymentId);
      setStep("betaling");
    } else {
      setAccessCode(createdBookings[0]?.accessCode ?? null);
      setStep("kvittering");
    }
  }

  async function pay() {
    if (!paymentId) return;
    setBusy(true);
    const res = await fetch(`/api/portal/pay/${paymentId}`, { method: "POST" });
    const data = await res.json();
    setBusy(false);
    if (data.bookings) setBookings(data.bookings);
    setAccessCode(data.accessCode);
    setStep("kvittering");
  }

  const hours = duration / 60;

  const ratePerHour = isGroup
    ? groupMembers.slice(0, groupCount).reduce((sum, m) => sum + (m.pricePerHour ?? 0), 0)
    : referenceFacility?.pricePerHour ?? 0;
  const requiresPayment = isGroup ? !!groupMembers[0]?.requiresPayment : !!referenceFacility?.requiresPayment;
  const totalPrice = Math.round(ratePerHour * hours * 100) / 100;

  function facilityNameFor(booking: BookingDTO): string {
    return facilities.find((f) => f.id === booking.facilityId)?.name ?? "Ukendt facilitet";
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-50 to-white flex justify-center px-4 py-8 md:py-14">
      <div className="w-full max-w-md">
        <div className="text-center mb-6">
          <div className="text-blue-600 font-semibold text-sm uppercase tracking-wide">Grenaa Idrætscenter</div>
          <h1 className="text-2xl font-bold text-slate-900 mt-1">Book en tid</h1>
        </div>

        <div className="flex items-center justify-center gap-2 mb-6">
          {["facilitet", "tid", "info", "kvittering"].map((s, i) => (
            <div
              key={s}
              className={`h-1.5 w-10 rounded-full ${
                ["facilitet", "tid", "info", "betaling", "kvittering"].indexOf(step) >= i ? "bg-blue-600" : "bg-slate-200"
              }`}
            />
          ))}
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          {step === "facilitet" && (
            <div className="space-y-4">
              <h2 className="font-semibold text-slate-900">Hvad vil du booke?</h2>
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {listItems.map((item) =>
                  item.type === "facility" ? (
                    <button
                      key={item.facility.id}
                      onClick={() => selectSingle(item.facility)}
                      className={`w-full text-left rounded-xl border px-4 py-3 flex items-center justify-between ${
                        selection?.kind === "single" && selection.facility.id === item.facility.id
                          ? "border-blue-500 bg-blue-50"
                          : "border-slate-200 hover:border-slate-300"
                      }`}
                    >
                      <span className="font-medium text-slate-800">
                        {item.facility.parentId ? "– " : ""}
                        {item.facility.name}
                      </span>
                      {item.facility.requiresPayment ? (
                        <span className="text-xs text-slate-500">{item.facility.pricePerHour} kr/time</span>
                      ) : (
                        <span className="text-xs text-emerald-600">Gratis</span>
                      )}
                    </button>
                  ) : (
                    <div
                      key={item.label}
                      className={`w-full text-left rounded-xl border px-4 py-3 ${
                        selection?.kind === "group" && selection.label === item.label
                          ? "border-blue-500 bg-blue-50"
                          : "border-slate-200 hover:border-slate-300"
                      }`}
                    >
                      <button
                        onClick={() => selectGroup(item.label, item.members)}
                        className="w-full text-left flex items-center justify-between"
                      >
                        <span className="font-medium text-slate-800">{item.label}</span>
                        {item.members[0]?.requiresPayment ? (
                          <span className="text-xs text-slate-500">{item.members[0].pricePerHour} kr/bane/time</span>
                        ) : (
                          <span className="text-xs text-emerald-600">Gratis</span>
                        )}
                      </button>
                      {selection?.kind === "group" && selection.label === item.label && (
                        <div className="mt-3 flex items-center justify-between rounded-lg bg-white border border-slate-200 px-3 py-2">
                          <span className="text-sm text-slate-600">Antal baner</span>
                          <div className="flex items-center gap-3">
                            <button
                              onClick={() => setGroupCount((n) => Math.max(1, n - 1))}
                              className="w-7 h-7 rounded-full border border-slate-300 text-slate-600 flex items-center justify-center"
                            >
                              −
                            </button>
                            <span className="w-4 text-center font-medium">{groupCount}</span>
                            <button
                              onClick={() => setGroupCount((n) => Math.min(item.members.length, n + 1))}
                              className="w-7 h-7 rounded-full border border-slate-300 text-slate-600 flex items-center justify-center"
                            >
                              +
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )
                )}
              </div>
              <button
                disabled={!selection}
                onClick={() => setStep("tid")}
                className="w-full rounded-xl bg-blue-600 text-white py-3 font-medium disabled:opacity-40"
              >
                Næste
              </button>
            </div>
          )}

          {step === "tid" && (
            <div className="space-y-5">
              <div>
                <h2 className="font-semibold text-slate-900">Vælg dag og tid</h2>
                <p className="text-sm text-slate-500 mt-0.5">
                  {selection?.kind === "group"
                    ? `${selection.label} · ${groupCount} ${groupCount === 1 ? "bane" : "baner"}`
                    : selection?.kind === "single"
                      ? selection.facility.name
                      : ""}
                </p>
              </div>

              {isGroup && (
                <div className="flex items-center justify-between rounded-xl border border-slate-200 px-3 py-2">
                  <span className="text-sm text-slate-600">Antal baner</span>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => {
                        setGroupCount((n) => Math.max(1, n - 1));
                        setPickedTime(null);
                      }}
                      className="w-8 h-8 rounded-full border border-slate-300 text-slate-600 flex items-center justify-center"
                      aria-label="Færre baner"
                    >
                      −
                    </button>
                    <span className="w-4 text-center font-medium">{groupCount}</span>
                    <button
                      onClick={() => {
                        setGroupCount((n) => Math.min(groupMembers.length, n + 1));
                        setPickedTime(null);
                      }}
                      className="w-8 h-8 rounded-full border border-slate-300 text-slate-600 flex items-center justify-center"
                      aria-label="Flere baner"
                    >
                      +
                    </button>
                  </div>
                </div>
              )}

              <div>
                <div className="text-sm font-medium text-slate-700 mb-2">Hvor længe?</div>
                <div className="grid grid-cols-3 gap-2">
                  {DURATIONS.map((d) => (
                    <button
                      key={d.minutes}
                      onClick={() => {
                        setDuration(d.minutes);
                        setPickedTime(null);
                      }}
                      className={`rounded-xl border py-2 text-sm font-medium ${
                        duration === d.minutes
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
                  {dayStrip.map(({ dayStr, anyFree }) => {
                    const d = new Date(`${dayStr}T00:00:00`);
                    const isSelected = dayStr === date;
                    return (
                      <button
                        key={dayStr}
                        onClick={() => chooseDate(dayStr)}
                        className={`shrink-0 w-16 rounded-xl border py-2 text-center ${
                          isSelected
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
                            anyFree === null
                              ? "bg-slate-300"
                              : anyFree
                                ? isSelected
                                  ? "bg-white"
                                  : "bg-emerald-500"
                                : isSelected
                                  ? "bg-white/50"
                                  : "bg-slate-300"
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
                <div className="text-sm font-medium text-slate-700 mb-2">
                  {capitalizeDaDate(
                    new Date(`${date}T00:00:00`).toLocaleDateString("da-DK", { weekday: "long", day: "numeric", month: "long" })
                  )}
                </div>
                {slotsError ? (
                  <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
                    Kunne ikke hente ledige tider.{" "}
                    <button className="underline" onClick={() => loadSlots(localISODate())}>
                      Prøv igen
                    </button>
                  </div>
                ) : !slotsReady || loadingSlots ? (
                  <div className="grid grid-cols-4 gap-2 animate-pulse">
                    {Array.from({ length: 12 }, (_, i) => (
                      <div key={i} className="h-11 rounded-lg bg-slate-100" />
                    ))}
                  </div>
                ) : (
                  <>
                    {[
                      { title: "Formiddag", from: 0, to: 12 * 60 },
                      { title: "Eftermiddag", from: 12 * 60, to: 17 * 60 },
                      { title: "Aften", from: 17 * 60, to: 24 * 60 },
                    ].map((part) => {
                      const inPart = daySlots.filter((sl) => {
                        if (sl.past) return false; // tider der allerede er gået vises slet ikke
                        const minutes = Number(sl.time.slice(0, 2)) * 60 + Number(sl.time.slice(3));
                        return minutes >= part.from && minutes < part.to;
                      });
                      if (inPart.length === 0) return null;
                      return (
                        <div key={part.title} className="mb-3">
                          <div className="text-xs uppercase tracking-wide text-slate-400 mb-1.5">{part.title}</div>
                          <div className="grid grid-cols-4 gap-2">
                            {inPart.map((sl) => {
                              const ok = !sl.past && sl.free.length >= need;
                              const isPicked = pickedOk && pickedTime === sl.time;
                              return (
                                <button
                                  key={sl.time}
                                  disabled={!ok}
                                  onClick={() => setPickedTime(sl.time)}
                                  className={`rounded-lg border py-1.5 text-center ${
                                    isPicked
                                      ? "border-blue-600 bg-blue-600 text-white"
                                      : ok
                                        ? "border-emerald-200 bg-emerald-50 text-emerald-800 hover:border-emerald-400"
                                        : "border-slate-100 bg-slate-50 text-slate-300 line-through"
                                  }`}
                                >
                                  <div className="text-sm font-medium">{sl.time}</div>
                                  {isGroup && ok && sl.free.length < groupMembers.length && (
                                    <div className={`text-[10px] ${isPicked ? "text-blue-100" : "text-emerald-600"}`}>
                                      {sl.free.length} ledige
                                    </div>
                                  )}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                    {!daySlots.some((sl) => !sl.past && sl.free.length >= need) && (
                      <div className="rounded-xl bg-slate-50 border border-slate-200 px-4 py-3 text-sm text-slate-600">
                        Der er ingen ledige tider denne dag.
                        {(() => {
                          const next = dayStrip.find((d) => d.dayStr > date && d.anyFree);
                          return next ? (
                            <button className="block mt-1 text-blue-700 font-medium underline" onClick={() => chooseDate(next.dayStr)}>
                              Gå til næste dag med ledige tider
                            </button>
                          ) : null;
                        })()}
                      </div>
                    )}
                  </>
                )}
              </div>

              {pickedOk && (
                <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
                  <div className="font-medium">
                    {capitalizeDaDate(
                      new Date(`${date}T00:00:00`).toLocaleDateString("da-DK", { weekday: "long", day: "numeric", month: "long" })
                    )}
                    {" · "}
                    {startTime}–{endTime}
                  </div>
                  <div className="text-blue-700">
                    {isGroup ? `${groupCount} ${groupCount === 1 ? "bane" : "baner"}` : referenceFacility?.name}
                    {requiresPayment ? ` · ${totalPrice} kr.` : " · Gratis"}
                  </div>
                </div>
              )}

              <div className="flex gap-3">
                <button onClick={() => setStep("facilitet")} className="flex-1 rounded-xl border border-slate-300 py-3 text-sm font-medium text-slate-700">
                  Tilbage
                </button>
                <button
                  disabled={!pickedOk}
                  onClick={() => setStep("info")}
                  className="flex-1 rounded-xl bg-blue-600 text-white py-3 font-medium disabled:opacity-40"
                >
                  Næste
                </button>
              </div>
            </div>
          )}

          {step === "info" && (
            <div className="space-y-4">
              <h2 className="font-semibold text-slate-900">Dine oplysninger</h2>
              {error && <div className="text-sm text-red-600">{error}</div>}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Navn</label>
                <input value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">E-mail</label>
                <input value={email} onChange={(e) => setEmail(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Telefon</label>
                <input value={phone} onChange={(e) => setPhone(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm" />
              </div>
              <div className="flex gap-3">
                <button onClick={() => setStep("tid")} className="flex-1 rounded-xl border border-slate-300 py-3 text-sm font-medium text-slate-700">
                  Tilbage
                </button>
                <button
                  disabled={!name || !email || busy}
                  onClick={submitBooking}
                  className="flex-1 rounded-xl bg-blue-600 text-white py-3 font-medium disabled:opacity-40"
                >
                  {busy ? "Sender..." : requiresPayment ? "Gå til betaling" : "Bekræft booking"}
                </button>
              </div>
            </div>
          )}

          {step === "betaling" && (
            <div className="space-y-4 text-center">
              <h2 className="font-semibold text-slate-900">Betaling</h2>
              <p className="text-sm text-slate-500">
                Der er endnu ikke koblet en rigtig betalingsudbyder til systemet. Dette er en simuleret betaling til
                demonstration.
              </p>
              {isGroup && (
                <div className="text-sm text-slate-500">
                  {groupCount} {groupCount === 1 ? "bane" : "baner"} &times; {hours} {hours === 1 ? "time" : "timer"}
                </div>
              )}
              <div className="rounded-xl bg-slate-50 border border-slate-200 py-4 text-2xl font-semibold text-slate-900">
                {totalPrice} kr.
              </div>
              <button onClick={pay} disabled={busy} className="w-full rounded-xl bg-blue-600 text-white py-3 font-medium disabled:opacity-40">
                {busy ? "Behandler..." : "Simulér betaling"}
              </button>
            </div>
          )}

          {step === "kvittering" && bookings.length > 0 && (
            <div className="space-y-4 text-center">
              <div className="text-4xl">&#10003;</div>
              <h2 className="font-semibold text-slate-900 text-lg">Booking bekræftet!</h2>
              <div className="text-sm text-slate-600">
                {bookings.map((b) => (
                  <div key={b.id}>{facilityNameFor(b)}</div>
                ))}
                <div className="mt-1">
                  {formatDaDate(bookings[0].startsAt)}
                  <br />
                  {formatDaTime(bookings[0].startsAt)} - {formatDaTime(bookings[0].endsAt)}
                </div>
              </div>
              {accessCode && (
                <div className="rounded-xl bg-blue-50 border border-blue-200 py-4">
                  <div className="text-xs text-blue-500 uppercase tracking-wide">Din dørkode</div>
                  <div className="text-3xl font-mono font-bold text-blue-800">{accessCode}</div>
                </div>
              )}
              <p className="text-xs text-slate-400">En bekræftelsesmail er sendt til {email} (se Notifikationer i administrationen).</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
