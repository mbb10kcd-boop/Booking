"use client";

import { useEffect, useMemo, useState } from "react";
import type { BookingDTO, FacilityDTO } from "@/lib/clientTypes";
import { formatDaDate, formatDaTime } from "@/lib/ai/messages";
import { combineDateAndTime, localISODate, addDays, roundTimeString } from "@/lib/date";
import { WheelStepInput } from "@/components/WheelStepInput";

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

const AVAILABILITY_DAY_START_HOUR = 7;
const AVAILABILITY_DAY_END_HOUR = 23;

export default function PublicBookingPortal() {
  const [facilities, setFacilities] = useState<FacilityDTO[]>([]);
  const [step, setStep] = useState<Step>("facilitet");
  const [selection, setSelection] = useState<Selection | null>(null);
  const [groupCount, setGroupCount] = useState(1);
  const [date, setDate] = useState(localISODate());
  const [startTime, setStartTime] = useState("18:00");
  const [endTime, setEndTime] = useState("19:00");
  const [availability, setAvailability] = useState<"ukendt" | "ledig" | "optaget">("ukendt");
  const [suggestions, setSuggestions] = useState<{ startsAt: string; endsAt: string }[]>([]);
  const [resolvedFacilityIds, setResolvedFacilityIds] = useState<string[]>([]);
  const [showAvailabilityBrowser, setShowAvailabilityBrowser] = useState(false);
  const [availabilityGrid, setAvailabilityGrid] = useState<{ dayStr: string; hour: number; free: number }[] | null>(
    null
  );
  const [loadingAvailabilityGrid, setLoadingAvailabilityGrid] = useState(false);
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
      .then((data) => setFacilities(data.filter((f: FacilityDTO) => !f.archived)));
  }, []);

  useEffect(() => {
    if (showAvailabilityBrowser && selection?.kind === "group") {
      loadAvailabilityGrid();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showAvailabilityBrowser, date, selection]);

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

  /**
   * Kernen af ledighedstjekket, som tager tidsrummet som eksplicitte
   * parametre i stedet for at læse `startTime`/`endTime` fra state - det
   * gør den sikker at kalde lige efter man har sat en NY tid (fx ved klik på
   * et foreslået tidspunkt), uden at ramme Reacts asynkrone state-opdatering
   * (staten ville stadig indeholde den GAMLE tid i samme funktionskald).
   */
  async function runAvailabilityCheck(startsAt: string, endsAt: string) {
    if (!selection) return;
    setAvailability("ukendt");

    if (selection.kind === "single") {
      const res = await fetch("/api/bookings/check-conflict", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ facilityId: selection.facility.id, startsAt, endsAt }),
      });
      const data = await res.json();
      if (data.status === "ledig") {
        setAvailability("ledig");
        setSuggestions([]);
        setResolvedFacilityIds([selection.facility.id]);
      } else {
        setAvailability("optaget");
        setSuggestions(data.suggestions?.alternativeTimes ?? []);
      }
      return;
    }

    const res = await fetch("/api/portal/group-availability", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        facilityIds: selection.members.map((m) => m.id),
        startsAt,
        endsAt,
        count: groupCount,
      }),
    });
    const data = await res.json();
    if (data.status === "ledig") {
      setAvailability("ledig");
      setSuggestions([]);
      setResolvedFacilityIds((data.availableFacilityIds as string[]).slice(0, groupCount));
    } else {
      setAvailability("optaget");
      setSuggestions(data.suggestions?.alternativeTimes ?? []);
    }
  }

  async function checkAvailability() {
    if (!date || !startTime || !endTime) return;
    await runAvailabilityCheck(combineDateAndTime(date, startTime), combineDateAndTime(date, endTime));
  }

  /**
   * Henter en uges ledighedsoversigt for den valgte gruppe (fx pickleball-/
   * badmintonbanerne) og regner klient-side ud hvor mange af banerne der er
   * ledige pr. time pr. dag - så man kan se HVORNÅR der er ledigt, i stedet
   * for kun at kunne tjekke ét tidspunkt ad gangen (Martin).
   */
  async function loadAvailabilityGrid() {
    if (selection?.kind !== "group") return;
    setLoadingAvailabilityGrid(true);
    const rangeStart = new Date(`${date}T00:00:00`);
    const rangeEnd = addDays(rangeStart, 7);
    const from = combineDateAndTime(localISODate(rangeStart), "00:00");
    const to = combineDateAndTime(localISODate(rangeEnd), "00:00");
    const memberIds = selection.members.map((m) => m.id);
    const res = await fetch(
      `/api/portal/availability?facilityIds=${memberIds.join(",")}&from=${from}&to=${to}`
    );
    const busyBlocks: { facilityId: string; startsAt: string; endsAt: string }[] = await res.json();

    const cells: { dayStr: string; hour: number; free: number }[] = [];
    for (let d = 0; d < 7; d++) {
      const day = addDays(rangeStart, d);
      const dayStr = localISODate(day);
      for (let hour = AVAILABILITY_DAY_START_HOUR; hour < AVAILABILITY_DAY_END_HOUR; hour++) {
        const slotStart = combineDateAndTime(dayStr, `${String(hour).padStart(2, "0")}:00`);
        const slotEnd = combineDateAndTime(dayStr, `${String(hour + 1).padStart(2, "0")}:00`);
        const busyFacilityIds = new Set(
          busyBlocks
            .filter((b) => b.startsAt < slotEnd && slotStart < b.endsAt)
            .map((b) => b.facilityId)
        );
        cells.push({ dayStr, hour, free: memberIds.length - busyFacilityIds.size });
      }
    }
    setAvailabilityGrid(cells);
    setLoadingAvailabilityGrid(false);
  }

  function pickGridSlot(dayStr: string, hour: number) {
    setDate(dayStr);
    setStartTime(`${String(hour).padStart(2, "0")}:00`);
    setEndTime(`${String(hour + 1).padStart(2, "0")}:00`);
    setAvailability("ukendt");
    setShowAvailabilityBrowser(false);
  }

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

  const hours = useMemo(() => {
    const start = combineDateAndTime(date, startTime);
    const end = combineDateAndTime(date, endTime);
    return Math.max(0, (new Date(end).getTime() - new Date(start).getTime()) / 3_600_000);
  }, [date, startTime, endTime]);

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
            <div className="space-y-4">
              <h2 className="font-semibold text-slate-900">Vælg dato og tidspunkt</h2>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Dato</label>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => {
                    setDate(e.target.value);
                    setAvailability("ukendt");
                    setAvailabilityGrid(null);
                  }}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Fra</label>
                  <WheelStepInput
                    type="time"
                    value={startTime}
                    onChange={(v) => {
                      setStartTime(v);
                      setAvailability("ukendt");
                    }}
                    onRoundedBlur={roundTimeString}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Til</label>
                  <WheelStepInput
                    type="time"
                    value={endTime}
                    onChange={(v) => {
                      setEndTime(v);
                      setAvailability("ukendt");
                    }}
                    onRoundedBlur={roundTimeString}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm"
                  />
                </div>
              </div>

              {isGroup && (
                <div>
                  <button
                    onClick={() => setShowAvailabilityBrowser((v) => !v)}
                    className="w-full rounded-xl border border-slate-300 text-slate-700 py-2.5 text-sm font-medium"
                  >
                    {showAvailabilityBrowser ? "Skjul ledige tider" : "Se hvornår der er ledigt"}
                  </button>
                  {showAvailabilityBrowser && (
                    <div className="mt-3 rounded-xl border border-slate-200 overflow-x-auto">
                      {loadingAvailabilityGrid || !availabilityGrid ? (
                        <div className="p-4 text-sm text-slate-400 text-center">Henter ledige tider...</div>
                      ) : (
                        <table className="w-full text-xs border-collapse">
                          <thead>
                            <tr>
                              <th className="p-1.5 text-slate-400 font-normal"></th>
                              {Array.from({ length: 7 }, (_, i) => addDays(new Date(`${date}T00:00:00`), i)).map((d) => (
                                <th key={d.toISOString()} className="p-1.5 text-slate-600 font-medium whitespace-nowrap">
                                  {d.toLocaleDateString("da-DK", { weekday: "short", day: "numeric", month: "numeric" })}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {Array.from(
                              { length: AVAILABILITY_DAY_END_HOUR - AVAILABILITY_DAY_START_HOUR },
                              (_, i) => AVAILABILITY_DAY_START_HOUR + i
                            ).map((hour) => (
                              <tr key={hour}>
                                <td className="p-1.5 text-slate-400 whitespace-nowrap">{String(hour).padStart(2, "0")}</td>
                                {Array.from({ length: 7 }, (_, i) =>
                                  localISODate(addDays(new Date(`${date}T00:00:00`), i))
                                ).map((dayStr) => {
                                  const cell = availabilityGrid.find((c) => c.dayStr === dayStr && c.hour === hour);
                                  const free = cell?.free ?? 0;
                                  const colorClass =
                                    free <= 0
                                      ? "bg-red-100 text-red-500"
                                      : free < groupMembers.length
                                        ? "bg-amber-100 text-amber-700"
                                        : "bg-emerald-100 text-emerald-700";
                                  return (
                                    <td key={dayStr} className="p-0.5">
                                      <button
                                        disabled={free <= 0}
                                        onClick={() => pickGridSlot(dayStr, hour)}
                                        className={`w-full rounded py-1 text-center disabled:opacity-40 ${colorClass}`}
                                      >
                                        {free}
                                      </button>
                                    </td>
                                  );
                                })}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                      <div className="px-2 py-1.5 text-[11px] text-slate-400 border-t border-slate-100">
                        Tallet viser hvor mange baner der er ledige. Klik en time for at vælge den.
                      </div>
                    </div>
                  )}
                </div>
              )}

              <button onClick={checkAvailability} className="w-full rounded-xl border border-blue-300 text-blue-700 py-2.5 text-sm font-medium">
                Tjek ledighed
              </button>
              {availability === "ledig" && (
                <div className="rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-3 text-sm text-emerald-800">
                  {isGroup ? `${groupCount} ${groupCount === 1 ? "bane er" : "baner er"} ledige!` : "Tiden er ledig!"}
                </div>
              )}
              {availability === "optaget" && (
                <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700 space-y-2">
                  <div>
                    {isGroup
                      ? `Der er desværre ikke ${groupCount} ledige baner på dette tidspunkt.`
                      : "Denne tid er desværre optaget."}
                  </div>
                  {suggestions.length > 0 && (
                    <div className="space-y-1">
                      <div className="font-medium">Ledige tider samme dag:</div>
                      {suggestions.map((s, i) => (
                        <button
                          key={i}
                          onClick={() => {
                            setDate(s.startsAt.slice(0, 10));
                            setStartTime(s.startsAt.slice(11, 16));
                            setEndTime(s.endsAt.slice(11, 16));
                            runAvailabilityCheck(s.startsAt, s.endsAt);
                          }}
                          className="block w-full text-left rounded-lg bg-white border border-red-200 px-3 py-1.5"
                        >
                          {formatDaTime(s.startsAt)} - {formatDaTime(s.endsAt)}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
              <div className="flex gap-3">
                <button onClick={() => setStep("facilitet")} className="flex-1 rounded-xl border border-slate-300 py-3 text-sm font-medium text-slate-700">
                  Tilbage
                </button>
                <button
                  disabled={availability !== "ledig"}
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
