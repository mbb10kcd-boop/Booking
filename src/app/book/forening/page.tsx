"use client";

import { useEffect, useMemo, useState } from "react";
import type { FacilityDTO } from "@/lib/clientTypes";
import { formatDaDate, formatDaDateShort, formatDaTime } from "@/lib/ai/messages";
import { addDays, combineDateAndTime, localISODate, roundTimeString, startOfWeek } from "@/lib/date";
import { WheelStepInput } from "@/components/WheelStepInput";

type Step = "forening" | "opret" | "afventer" | "faciliteter" | "dato" | "info" | "kvittering";

type OrgSummary = { id: string; name: string };
type OrgDetail = { id: string; name: string; contactName: string | null; contactEmail: string | null };
type BusyInterval = { facilityId: string; startsAt: string; endsAt: string };

export default function ForeningBookingPortal() {
  const [step, setStep] = useState<Step>("forening");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // --- Trin 1: forening ---
  const [orgs, setOrgs] = useState<OrgSummary[]>([]);
  const [orgSearch, setOrgSearch] = useState("");
  const [selectedOrg, setSelectedOrg] = useState<OrgDetail | null>(null);

  // --- Trin "opret forening" ---
  const [newOrgName, setNewOrgName] = useState("");
  const [newOrgCvr, setNewOrgCvr] = useState("");
  const [newOrgAddress, setNewOrgAddress] = useState("");
  const [newOrgContactName, setNewOrgContactName] = useState("");
  const [newOrgContactEmail, setNewOrgContactEmail] = useState("");
  const [newOrgContactPhone, setNewOrgContactPhone] = useState("");

  // --- Trin 2: faciliteter ---
  const [facilities, setFacilities] = useState<FacilityDTO[]>([]);
  const [selectedFacilityIds, setSelectedFacilityIds] = useState<Set<string>>(new Set());

  // --- Trin 3: dato ---
  const [weekStart, setWeekStart] = useState<Date>(() => startOfWeek(new Date()));
  const [busyIntervals, setBusyIntervals] = useState<BusyInterval[]>([]);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [startTime, setStartTime] = useState("18:00");
  const [endTime, setEndTime] = useState("19:00");
  const [availability, setAvailability] = useState<"ukendt" | "ledig" | "optaget">("ukendt");
  const [busyFacilityNames, setBusyFacilityNames] = useState<string[]>([]);

  // --- Trin 4: info ---
  const [extraEmail, setExtraEmail] = useState("");
  const [notes, setNotes] = useState("");

  // --- Trin 5: kvittering ---
  const [createdBookings, setCreatedBookings] = useState<{ id: string; facilityId: string; accessCode: string | null }[]>([]);

  useEffect(() => {
    fetch("/api/portal/organizations")
      .then((r) => r.json())
      .then(setOrgs);
    fetch("/api/facilities")
      .then((r) => r.json())
      .then((data: FacilityDTO[]) => setFacilities(data.filter((f) => !f.archived && !f.hiddenFromOrgPortal)));
  }, []);

  const filteredOrgs = useMemo(
    () => orgs.filter((o) => o.name.toLowerCase().includes(orgSearch.toLowerCase())),
    [orgs, orgSearch]
  );

  const selectedFacilities = facilities.filter((f) => selectedFacilityIds.has(f.id));

  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);

  async function selectOrganization(id: string) {
    setError(null);
    const res = await fetch(`/api/portal/organizations/${id}`);
    if (!res.ok) {
      setError("Kunne ikke hente foreningens oplysninger. Prøv igen.");
      return;
    }
    setSelectedOrg(await res.json());
    setStep("faciliteter");
  }

  async function createOrganization() {
    if (!newOrgName.trim() || !newOrgContactName.trim() || !newOrgContactEmail.trim()) {
      setError("Udfyld venligst foreningens navn, kontaktperson og e-mail");
      return;
    }
    setBusy(true);
    setError(null);
    const res = await fetch("/api/portal/organizations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: newOrgName,
        cvr: newOrgCvr,
        address: newOrgAddress,
        contactName: newOrgContactName,
        contactEmail: newOrgContactEmail,
        contactPhone: newOrgContactPhone,
      }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json();
      setError(data.error ?? "Der opstod en fejl.");
      return;
    }
    setStep("afventer");
  }

  function toggleFacility(id: string) {
    setSelectedFacilityIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function loadWeekAvailability(start: Date) {
    if (selectedFacilityIds.size === 0) return;
    const from = localISODate(start);
    const to = localISODate(addDays(start, 7));
    const params = new URLSearchParams({
      facilityIds: Array.from(selectedFacilityIds).join(","),
      from: combineDateAndTime(from, "00:00"),
      to: combineDateAndTime(to, "00:00"),
    });
    const res = await fetch(`/api/portal/availability?${params.toString()}`);
    setBusyIntervals(await res.json());
  }

  useEffect(() => {
    if (step === "dato") loadWeekAvailability(weekStart);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, weekStart, selectedFacilityIds]);

  function busyRangesForDay(dateISO: string): string[] {
    const ranges = busyIntervals
      .filter((b) => b.startsAt.slice(0, 10) === dateISO || b.endsAt.slice(0, 10) === dateISO)
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    return ranges.map((r) => `${formatDaTime(r.startsAt)}-${formatDaTime(r.endsAt)}`);
  }

  function selectDay(dateISO: string) {
    setSelectedDate(dateISO);
    setAvailability("ukendt");
    setBusyFacilityNames([]);
  }

  async function checkAvailability() {
    if (!selectedDate || selectedFacilityIds.size === 0) return;
    setAvailability("ukendt");
    setBusy(true);
    const startsAt = combineDateAndTime(selectedDate, startTime);
    const endsAt = combineDateAndTime(selectedDate, endTime);
    const busyNames: string[] = [];
    for (const facility of selectedFacilities) {
      const res = await fetch("/api/bookings/check-conflict", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ facilityId: facility.id, startsAt, endsAt }),
      });
      const data = await res.json();
      if (data.status !== "ledig") busyNames.push(facility.name);
    }
    setBusy(false);
    if (busyNames.length > 0) {
      setAvailability("optaget");
      setBusyFacilityNames(busyNames);
    } else {
      setAvailability("ledig");
    }
  }

  async function submitBooking() {
    if (!selectedOrg || !selectedDate) return;
    setBusy(true);
    setError(null);
    const startsAt = combineDateAndTime(selectedDate, startTime);
    const endsAt = combineDateAndTime(selectedDate, endTime);
    const res = await fetch("/api/portal/book-forening", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        organizationId: selectedOrg.id,
        facilityIds: Array.from(selectedFacilityIds),
        startsAt,
        endsAt,
        extraEmail: extraEmail || undefined,
        notes: notes || undefined,
      }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) {
      setError(data.error ?? "Der opstod en fejl.");
      return;
    }
    setCreatedBookings(data.bookings);
    setStep("kvittering");
  }

  const stepOrder: Step[] = ["forening", "faciliteter", "dato", "info", "kvittering"];
  const stepIndex = stepOrder.indexOf(step) >= 0 ? stepOrder.indexOf(step) : 0;

  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-50 to-white flex justify-center px-4 py-8 md:py-14">
      <div className="w-full max-w-md">
        <div className="text-center mb-6">
          <div className="text-blue-600 font-semibold text-sm uppercase tracking-wide">Grenaa Idrætscenter</div>
          <h1 className="text-2xl font-bold text-slate-900 mt-1">Book for en forening</h1>
        </div>

        <div className="flex items-center justify-center gap-2 mb-6">
          {stepOrder.map((s, i) => (
            <div key={s} className={`h-1.5 w-10 rounded-full ${stepIndex >= i ? "bg-blue-600" : "bg-slate-200"}`} />
          ))}
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          {error && <div className="mb-4 text-sm text-red-600">{error}</div>}

          {step === "forening" && (
            <div className="space-y-4">
              <h2 className="font-semibold text-slate-900">Vælg jeres forening</h2>
              <input
                value={orgSearch}
                onChange={(e) => setOrgSearch(e.target.value)}
                placeholder="Søg efter forening..."
                className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm"
              />
              <div className="space-y-2 max-h-72 overflow-y-auto">
                {filteredOrgs.map((o) => (
                  <button
                    key={o.id}
                    onClick={() => selectOrganization(o.id)}
                    className="w-full text-left rounded-xl border border-slate-200 hover:border-blue-300 px-4 py-3 font-medium text-slate-800"
                  >
                    {o.name}
                  </button>
                ))}
                {filteredOrgs.length === 0 && (
                  <div className="text-sm text-slate-400 text-center py-4">Ingen foreninger matcher søgningen.</div>
                )}
              </div>
              <button
                onClick={() => setStep("opret")}
                className="w-full rounded-xl border border-blue-300 text-blue-700 py-2.5 text-sm font-medium hover:bg-blue-50"
              >
                + Opret forening
              </button>
            </div>
          )}

          {step === "opret" && (
            <div className="space-y-4">
              <h2 className="font-semibold text-slate-900">Opret forening</h2>
              <p className="text-xs text-slate-500">
                Jeres forening skal godkendes af Grenaa Idrætscenter, før I kan booke. I får besked, når det er sket.
              </p>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Foreningens navn</label>
                <input value={newOrgName} onChange={(e) => setNewOrgName(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">CVR (valgfrit)</label>
                <input value={newOrgCvr} onChange={(e) => setNewOrgCvr(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Adresse (valgfrit)</label>
                <input value={newOrgAddress} onChange={(e) => setNewOrgAddress(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Kontaktperson</label>
                <input value={newOrgContactName} onChange={(e) => setNewOrgContactName(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">E-mail</label>
                <input value={newOrgContactEmail} onChange={(e) => setNewOrgContactEmail(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Telefon (valgfrit)</label>
                <input value={newOrgContactPhone} onChange={(e) => setNewOrgContactPhone(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm" />
              </div>
              <div className="flex gap-3">
                <button onClick={() => setStep("forening")} className="flex-1 rounded-xl border border-slate-300 py-3 text-sm font-medium text-slate-700">
                  Tilbage
                </button>
                <button
                  onClick={createOrganization}
                  disabled={busy}
                  className="flex-1 rounded-xl bg-blue-600 text-white py-3 font-medium disabled:opacity-40"
                >
                  {busy ? "Sender..." : "Send til godkendelse"}
                </button>
              </div>
            </div>
          )}

          {step === "afventer" && (
            <div className="space-y-4 text-center">
              <div className="text-4xl">&#128203;</div>
              <h2 className="font-semibold text-slate-900 text-lg">Tak!</h2>
              <p className="text-sm text-slate-600">
                Jeres forening afventer nu godkendelse hos Grenaa Idrætscenter. I får besked, så snart I kan begynde at
                booke.
              </p>
              <a href="/book" className="block text-sm text-blue-600 font-medium">
                Tilbage til forsiden
              </a>
            </div>
          )}

          {step === "faciliteter" && (
            <div className="space-y-4">
              <h2 className="font-semibold text-slate-900">Vælg faciliteter</h2>
              <p className="text-xs text-slate-500">I kan vælge flere faciliteter på én gang, fx både et mødelokale og en hal.</p>
              <div className="space-y-2 max-h-80 overflow-y-auto">
                {facilities.map((f) => (
                  <label
                    key={f.id}
                    className={`w-full flex items-center gap-3 rounded-xl border px-4 py-3 cursor-pointer ${
                      selectedFacilityIds.has(f.id) ? "border-blue-500 bg-blue-50" : "border-slate-200 hover:border-slate-300"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selectedFacilityIds.has(f.id)}
                      onChange={() => toggleFacility(f.id)}
                      className="h-4 w-4"
                    />
                    <span className="font-medium text-slate-800">
                      {f.parentId ? "– " : ""}
                      {f.name}
                    </span>
                  </label>
                ))}
              </div>
              <div className="flex gap-3">
                <button onClick={() => setStep("forening")} className="flex-1 rounded-xl border border-slate-300 py-3 text-sm font-medium text-slate-700">
                  Tilbage
                </button>
                <button
                  disabled={selectedFacilityIds.size === 0}
                  onClick={() => setStep("dato")}
                  className="flex-1 rounded-xl bg-blue-600 text-white py-3 font-medium disabled:opacity-40"
                >
                  Næste
                </button>
              </div>
            </div>
          )}

          {step === "dato" && (
            <div className="space-y-4">
              <h2 className="font-semibold text-slate-900">Vælg dato</h2>
              <div className="flex items-center justify-between">
                <button onClick={() => setWeekStart((w) => addDays(w, -7))} className="text-slate-400 hover:text-slate-700 px-2">
                  &larr;
                </button>
                <span className="text-sm font-medium text-slate-700">
                  {formatDaDateShort(`${localISODate(weekStart)}T00:00:00`)} - {formatDaDateShort(`${localISODate(addDays(weekStart, 6))}T00:00:00`)}
                </span>
                <button onClick={() => setWeekStart((w) => addDays(w, 7))} className="text-slate-400 hover:text-slate-700 px-2">
                  &rarr;
                </button>
              </div>
              <div className="space-y-1.5 max-h-64 overflow-y-auto">
                {weekDays.map((d) => {
                  const dateISO = localISODate(d);
                  const ranges = busyRangesForDay(dateISO);
                  const isSelected = selectedDate === dateISO;
                  return (
                    <button
                      key={dateISO}
                      onClick={() => selectDay(dateISO)}
                      className={`w-full text-left rounded-lg border px-3 py-2 text-sm ${
                        isSelected ? "border-blue-500 bg-blue-50" : "border-slate-200 hover:border-slate-300"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-slate-800 capitalize">{formatDaDateShort(`${dateISO}T00:00:00`)}</span>
                        {ranges.length === 0 ? (
                          <span className="text-xs text-emerald-600">Ledig hele dagen</span>
                        ) : (
                          <span className="text-xs text-amber-600">Optaget: {ranges.join(", ")}</span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>

              {selectedDate && (
                <div className="space-y-3 border-t border-slate-100 pt-4">
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
                  <button
                    onClick={checkAvailability}
                    disabled={busy}
                    className="w-full rounded-xl border border-blue-300 text-blue-700 py-2.5 text-sm font-medium disabled:opacity-50"
                  >
                    {busy ? "Tjekker..." : "Tjek ledighed"}
                  </button>
                  {availability === "ledig" && (
                    <div className="rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-3 text-sm text-emerald-800">
                      Tiden er ledig i alle valgte faciliteter!
                    </div>
                  )}
                  {availability === "optaget" && (
                    <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
                      Optaget i: {busyFacilityNames.join(", ")}
                    </div>
                  )}
                </div>
              )}

              <div className="flex gap-3">
                <button onClick={() => setStep("faciliteter")} className="flex-1 rounded-xl border border-slate-300 py-3 text-sm font-medium text-slate-700">
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

          {step === "info" && selectedOrg && selectedDate && (
            <div className="space-y-4">
              <h2 className="font-semibold text-slate-900">Bekræft oplysninger</h2>
              <div className="rounded-xl bg-slate-50 border border-slate-200 p-4 text-sm space-y-1">
                <div className="font-medium text-slate-800">{selectedFacilities.map((f) => f.name).join(", ")}</div>
                <div className="text-slate-500">
                  {formatDaDate(combineDateAndTime(selectedDate, startTime))}, {startTime}-{endTime}
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Kontaktperson</label>
                <input value={selectedOrg.contactName ?? ""} disabled className="w-full rounded-lg border border-slate-200 bg-slate-100 px-3 py-2.5 text-sm text-slate-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Registreret e-mail</label>
                <input value={selectedOrg.contactEmail ?? ""} disabled className="w-full rounded-lg border border-slate-200 bg-slate-100 px-3 py-2.5 text-sm text-slate-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Tilføj evt. en ekstra e-mail</label>
                <input
                  value={extraEmail}
                  onChange={(e) => setExtraEmail(e.target.value)}
                  placeholder="fx en anden fra bestyrelsen"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm"
                />
                <p className="text-xs text-slate-400 mt-1">
                  En eventuel fremtidig aflysning eller flytning sendes til både den registrerede mail og denne.
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Note (valgfrit)</label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="fx &quot;skal bruge mikrofon&quot;"
                  rows={3}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm"
                />
              </div>
              <div className="flex gap-3">
                <button onClick={() => setStep("dato")} className="flex-1 rounded-xl border border-slate-300 py-3 text-sm font-medium text-slate-700">
                  Tilbage
                </button>
                <button
                  onClick={submitBooking}
                  disabled={busy}
                  className="flex-1 rounded-xl bg-blue-600 text-white py-3 font-medium disabled:opacity-40"
                >
                  {busy ? "Sender..." : "Bekræft booking"}
                </button>
              </div>
            </div>
          )}

          {step === "kvittering" && selectedDate && (
            <div className="space-y-4 text-center">
              <div className="text-4xl">&#10003;</div>
              <h2 className="font-semibold text-slate-900 text-lg">Booking bekræftet!</h2>
              <div className="text-sm text-slate-600">
                {selectedFacilities.map((f) => f.name).join(", ")}
                <br />
                {formatDaDate(combineDateAndTime(selectedDate, startTime))}
                <br />
                {startTime} - {endTime}
              </div>
              <div className="space-y-2">
                {createdBookings.map((b) => {
                  const facility = facilities.find((f) => f.id === b.facilityId);
                  return (
                    <div key={b.id} className="rounded-xl bg-blue-50 border border-blue-200 py-3">
                      <div className="text-xs text-blue-500 uppercase tracking-wide">{facility?.name ?? "Dørkode"}</div>
                      <div className="text-2xl font-mono font-bold text-blue-800">{b.accessCode}</div>
                    </div>
                  );
                })}
              </div>
              <p className="text-xs text-slate-400">
                En bekræftelsesmail er sendt til {selectedOrg?.contactEmail}
                {extraEmail ? ` og ${extraEmail}` : ""}.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
