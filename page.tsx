"use client";

import { useEffect, useState } from "react";
import type { FacilityDTO } from "@/lib/clientTypes";
import { formatDaDate, formatDaTime } from "@/lib/ai/messages";
import { combineDateAndTime, localISODate, roundTimeString } from "@/lib/date";

type Step = "facilitet" | "tid" | "info" | "betaling" | "kvittering";

export default function PublicBookingPortal() {
  const [facilities, setFacilities] = useState<FacilityDTO[]>([]);
  const [step, setStep] = useState<Step>("facilitet");
  const [facilityId, setFacilityId] = useState("");
  const [date, setDate] = useState(localISODate());
  const [startTime, setStartTime] = useState("18:00");
  const [endTime, setEndTime] = useState("19:00");
  const [availability, setAvailability] = useState<"ukendt" | "ledig" | "optaget">("ukendt");
  const [suggestions, setSuggestions] = useState<{ startsAt: string; endsAt: string }[]>([]);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [booking, setBooking] = useState<any>(null);
  const [paymentId, setPaymentId] = useState<string | null>(null);
  const [accessCode, setAccessCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/facilities")
      .then((r) => r.json())
      .then((data) => setFacilities(data.filter((f: FacilityDTO) => !f.archived)));
  }, []);

  const selectedFacility = facilities.find((f) => f.id === facilityId);

  async function checkAvailability() {
    if (!facilityId || !date || !startTime || !endTime) return;
    setAvailability("ukendt");
    const startsAt = combineDateAndTime(date, startTime);
    const endsAt = combineDateAndTime(date, endTime);
    const res = await fetch("/api/bookings/check-conflict", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ facilityId, startsAt, endsAt }),
    });
    const data = await res.json();
    if (data.status === "ledig") {
      setAvailability("ledig");
      setSuggestions([]);
    } else {
      setAvailability("optaget");
      setSuggestions(data.suggestions?.alternativeTimes ?? []);
    }
  }

  async function submitBooking() {
    setBusy(true);
    setError(null);
    const startsAt = combineDateAndTime(date, startTime);
    const endsAt = combineDateAndTime(date, endTime);
    const res = await fetch("/api/portal/book", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ facilityId, startsAt, endsAt, name, email, phone }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) {
      setError(data.error ?? "Der opstod en fejl.");
      return;
    }
    setBooking(data.booking);
    if (data.requiresPayment) {
      setPaymentId(data.paymentId);
      setStep("betaling");
    } else {
      setAccessCode(data.booking.accessCode);
      setStep("kvittering");
    }
  }

  async function pay() {
    if (!paymentId) return;
    setBusy(true);
    const res = await fetch(`/api/portal/pay/${paymentId}`, { method: "POST" });
    const data = await res.json();
    setBusy(false);
    setAccessCode(data.accessCode);
    setStep("kvittering");
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
              <div className="space-y-2 max-h-80 overflow-y-auto">
                {facilities.map((f) => (
                  <button
                    key={f.id}
                    onClick={() => setFacilityId(f.id)}
                    className={`w-full text-left rounded-xl border px-4 py-3 flex items-center justify-between ${
                      facilityId === f.id ? "border-blue-500 bg-blue-50" : "border-slate-200 hover:border-slate-300"
                    }`}
                  >
                    <span className="font-medium text-slate-800">
                      {f.parentId ? "– " : ""}
                      {f.name}
                    </span>
                    {f.requiresPayment ? <span className="text-xs text-slate-500">{f.pricePerHour} kr/time</span> : <span className="text-xs text-emerald-600">Gratis</span>}
                  </button>
                ))}
              </div>
              <button
                disabled={!facilityId}
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
                  }}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Fra</label>
                  <input
                    type="time"
                    step={600}
                    value={startTime}
                    onChange={(e) => {
                      setStartTime(e.target.value);
                      setAvailability("ukendt");
                    }}
                    onBlur={(e) => e.target.value && setStartTime(roundTimeString(e.target.value))}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Til</label>
                  <input
                    type="time"
                    step={600}
                    value={endTime}
                    onChange={(e) => {
                      setEndTime(e.target.value);
                      setAvailability("ukendt");
                    }}
                    onBlur={(e) => e.target.value && setEndTime(roundTimeString(e.target.value))}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm"
                  />
                </div>
              </div>
              <button onClick={checkAvailability} className="w-full rounded-xl border border-blue-300 text-blue-700 py-2.5 text-sm font-medium">
                Tjek ledighed
              </button>
              {availability === "ledig" && (
                <div className="rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-3 text-sm text-emerald-800">
                  Tiden er ledig!
                </div>
              )}
              {availability === "optaget" && (
                <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700 space-y-2">
                  <div>Denne tid er desværre optaget.</div>
                  {suggestions.length > 0 && (
                    <div className="space-y-1">
                      <div className="font-medium">Ledige tider samme dag:</div>
                      {suggestions.map((s, i) => (
                        <button
                          key={i}
                          onClick={() => {
                            setStartTime(s.startsAt.slice(11, 16));
                            setEndTime(s.endsAt.slice(11, 16));
                            setAvailability("ledig");
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
                  {busy ? "Sender..." : selectedFacility?.requiresPayment ? "Gå til betaling" : "Bekræft booking"}
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
              <div className="rounded-xl bg-slate-50 border border-slate-200 py-4 text-2xl font-semibold text-slate-900">
                {selectedFacility?.pricePerHour} kr.
              </div>
              <button onClick={pay} disabled={busy} className="w-full rounded-xl bg-blue-600 text-white py-3 font-medium disabled:opacity-40">
                {busy ? "Behandler..." : "Simulér betaling"}
              </button>
            </div>
          )}

          {step === "kvittering" && booking && (
            <div className="space-y-4 text-center">
              <div className="text-4xl">&#10003;</div>
              <h2 className="font-semibold text-slate-900 text-lg">Booking bekræftet!</h2>
              <div className="text-sm text-slate-600">
                {selectedFacility?.name}
                <br />
                {formatDaDate(booking.startsAt)}
                <br />
                {formatDaTime(booking.startsAt)} - {formatDaTime(booking.endsAt)}
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
