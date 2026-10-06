"use client";

import { useEffect, useMemo, useState } from "react";
import type { FacilityDTO } from "@/lib/clientTypes";
import { formatDaDate, capitalizeDaDate } from "@/lib/ai/messages";
import { combineDateAndTime } from "@/lib/date";
import { weekdayName } from "@/lib/statusLabels";
import { SlotPicker, type SlotSelection } from "@/components/SlotPicker";

type Step =
  | "forening"
  | "opret"
  | "afventer"
  | "hvad"
  | "faciliteter"
  | "dato"
  | "info"
  | "kvittering"
  | "aflys"
  | "aflys_kvittering";

type SeriesItem = {
  seasonGroupId: string;
  facilityName: string;
  weekday: number;
  startTime: string;
  endTime: string;
  firstDate: string;
  lastDate: string;
  dates: string[];
};
type SingleItem = { id: string; facilityName: string; date: string; startTime: string; endTime: string };
type CancelTarget = { type: "series"; series: SeriesItem } | { type: "single"; booking: SingleItem };

const fmtTime = (t: string) => t.replace(":", ".");
const fmtDay = (d: string) => capitalizeDaDate(formatDaDate(`${d}T00:00:00`));
const fmtShort = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString("da-DK", { day: "numeric", month: "short" }).replace(".", "");

type OrgSummary = { id: string; name: string };
type OrgDetail = { id: string; name: string; contactName: string | null; contactEmail: string | null };

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

  // --- Trin 3: dato/tid (SlotPicker melder det aktuelle valg) ---
  const [slot, setSlot] = useState<SlotSelection | null>(null);
  const selectedDate = slot?.date ?? null;
  const startTime = slot?.startTime ?? "";
  const endTime = slot?.endTime ?? "";
  const availability: "ukendt" | "ledig" | "optaget" = !slot ? "ukendt" : slot.occupied ? "optaget" : "ledig";

  // --- Anmod om aflysning ---
  const [orgBookings, setOrgBookings] = useState<{ series: SeriesItem[]; singles: SingleItem[] } | null>(null);
  const [loadingOrgBookings, setLoadingOrgBookings] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<CancelTarget | null>(null);
  const [cancelScope, setCancelScope] = useState<"alt" | "fra_dato" | "enkelt">("alt");
  const [cancelDate, setCancelDate] = useState("");
  const [cancelNotes, setCancelNotes] = useState("");

  // --- Trin 4: info ---
  const [extraEmail, setExtraEmail] = useState("");
  const [notes, setNotes] = useState("");

  // --- Trin 5: kvittering ---
  const [createdBookings, setCreatedBookings] = useState<{ id: string; facilityId: string; accessCode: string | null }[]>([]);
  // "anmodning" når det ønskede tidsrum var optaget, og der derfor blev sendt
  // en anmodning om aflysning/flytning i stedet for en rigtig booking.
  const [submissionType, setSubmissionType] = useState<"booking" | "anmodning">("booking");

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

  async function selectOrganization(id: string) {
    setError(null);
    const res = await fetch(`/api/portal/organizations/${id}`);
    if (!res.ok) {
      setError("Kunne ikke hente foreningens oplysninger. Prøv igen.");
      return;
    }
    setSelectedOrg(await res.json());
    setStep("hvad");
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

  async function openCancelStep() {
    if (!selectedOrg) return;
    setError(null);
    setCancelTarget(null);
    setStep("aflys");
    setLoadingOrgBookings(true);
    try {
      const res = await fetch(`/api/portal/organizations/${selectedOrg.id}/bookings`);
      if (!res.ok) throw new Error("fejl");
      setOrgBookings(await res.json());
    } catch {
      setError("Kunne ikke hente jeres bookinger. Prøv igen.");
      setOrgBookings({ series: [], singles: [] });
    } finally {
      setLoadingOrgBookings(false);
    }
  }

  function chooseCancelTarget(target: CancelTarget) {
    setCancelTarget(target);
    setCancelScope("alt");
    setCancelDate(target.type === "series" ? target.series.dates[0] : "");
    setError(null);
  }

  async function submitCancellation() {
    if (!selectedOrg || !cancelTarget) return;
    setBusy(true);
    setError(null);
    const res = await fetch("/api/portal/request-cancellation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        cancelTarget.type === "series"
          ? {
              organizationId: selectedOrg.id,
              seasonGroupId: cancelTarget.series.seasonGroupId,
              scope: cancelScope,
              fromDate: cancelScope === "fra_dato" ? cancelDate : undefined,
              onlyDate: cancelScope === "enkelt" ? cancelDate : undefined,
              notes: cancelNotes || undefined,
            }
          : {
              organizationId: selectedOrg.id,
              bookingId: cancelTarget.booking.id,
              scope: "enkelt",
              notes: cancelNotes || undefined,
            }
      ),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(data.error ?? "Der opstod en fejl.");
      return;
    }
    setStep("aflys_kvittering");
  }

  async function submitBooking() {
    if (!selectedOrg || !selectedDate) return;
    setBusy(true);
    setError(null);
    const startsAt = combineDateAndTime(selectedDate, startTime);
    const endsAt = combineDateAndTime(selectedDate, endTime);
    // Er tiden optaget, sendes en anmodning om aflysning/flytning i stedet
    // for en rigtig booking - se /api/portal/request-reschedule.
    const isRequest = availability === "optaget";
    const res = await fetch(isRequest ? "/api/portal/request-reschedule" : "/api/portal/book-forening", {
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
    if (isRequest) {
      setSubmissionType("anmodning");
      setCreatedBookings([]);
    } else {
      setSubmissionType("booking");
      setCreatedBookings(data.bookings);
    }
    setStep("kvittering");
  }

  const stepOrder: Step[] = ["forening", "faciliteter", "dato", "info", "kvittering"];
  const stepIndexByStep: Partial<Record<Step, number>> = {
    forening: 0,
    opret: 0,
    afventer: 0,
    hvad: 0,
    aflys: 1,
    aflys_kvittering: 4,
  };
  const stepIndex = stepIndexByStep[step] ?? Math.max(0, stepOrder.indexOf(step));

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

          {step === "hvad" && selectedOrg && (
            <div className="space-y-4">
              <div>
                <h2 className="font-semibold text-slate-900">Hej {selectedOrg.name}</h2>
                <p className="text-sm text-slate-500 mt-0.5">Hvad vil I?</p>
              </div>
              <button
                onClick={() => setStep("faciliteter")}
                className="w-full text-left rounded-2xl border border-slate-200 hover:border-blue-300 hover:shadow-sm transition px-4 py-4"
              >
                <div className="font-semibold text-slate-900">Book en ny tid</div>
                <div className="text-sm text-slate-500 mt-0.5">Vælg faciliteter, dag og tidspunkt.</div>
              </button>
              <button
                onClick={openCancelStep}
                className="w-full text-left rounded-2xl border border-slate-200 hover:border-blue-300 hover:shadow-sm transition px-4 py-4"
              >
                <div className="font-semibold text-slate-900">Anmod om aflysning</div>
                <div className="text-sm text-slate-500 mt-0.5">
                  Aflys en sæsonbooking (hele sæsonen, fra en dato eller kun én dag) eller en enkelt booking.
                </div>
              </button>
              <button onClick={() => setStep("forening")} className="w-full text-sm text-slate-500 py-1">
                Skift forening
              </button>
            </div>
          )}

          {step === "aflys" && selectedOrg && (
            <div className="space-y-4">
              <div>
                <h2 className="font-semibold text-slate-900">Anmod om aflysning</h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Vælg den booking eller sæson, I vil aflyse. Aflysningen skal godkendes af Grenaa Idrætscenter - I får
                  en mail, når den er behandlet. Indtil da er bookingen stadig gældende.
                </p>
              </div>

              {loadingOrgBookings || !orgBookings ? (
                <div className="space-y-2 animate-pulse">
                  <div className="h-16 rounded-xl bg-slate-100" />
                  <div className="h-16 rounded-xl bg-slate-100" />
                </div>
              ) : orgBookings.series.length === 0 && orgBookings.singles.length === 0 ? (
                <div className="rounded-xl bg-slate-50 border border-slate-200 px-4 py-6 text-center text-sm text-slate-500">
                  I har ingen kommende bookinger.
                </div>
              ) : (
                <div className="space-y-2 max-h-[28rem] overflow-y-auto">
                  {orgBookings.series.length > 0 && (
                    <div className="text-xs uppercase tracking-wide text-slate-400">Sæsonbookinger</div>
                  )}
                  {orgBookings.series.map((sr) => {
                    const picked = cancelTarget?.type === "series" && cancelTarget.series.seasonGroupId === sr.seasonGroupId;
                    return (
                      <div
                        key={sr.seasonGroupId}
                        className={`rounded-xl border ${picked ? "border-blue-500 bg-blue-50/40" : "border-slate-200"}`}
                      >
                        <button onClick={() => chooseCancelTarget({ type: "series", series: sr })} className="w-full text-left px-4 py-3">
                          <div className="font-medium text-slate-800">
                            Hver {weekdayName(sr.weekday).toLowerCase()} kl. {fmtTime(sr.startTime)}-{fmtTime(sr.endTime)}
                          </div>
                          <div className="text-xs text-slate-500">
                            {sr.facilityName} · {fmtShort(sr.firstDate)} – {fmtShort(sr.lastDate)} · {sr.dates.length}{" "}
                            {sr.dates.length === 1 ? "gang" : "gange"} tilbage
                          </div>
                        </button>
                        {picked && (
                          <div className="px-4 pb-4 space-y-3 border-t border-slate-100 pt-3">
                            {(
                              [
                                ["alt", `Hele resten af sæsonen (${sr.dates.length} ${sr.dates.length === 1 ? "gang" : "gange"})`],
                                ["fra_dato", "Fra og med en bestemt dato"],
                                ["enkelt", "Kun én bestemt dag"],
                              ] as const
                            ).map(([value, label]) => (
                              <label key={value} className="flex items-center gap-2 text-sm text-slate-700">
                                <input type="radio" name="scope" checked={cancelScope === value} onChange={() => setCancelScope(value)} />
                                {label}
                              </label>
                            ))}
                            {cancelScope !== "alt" && (
                              <select
                                value={cancelDate}
                                onChange={(e) => setCancelDate(e.target.value)}
                                className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm"
                              >
                                {sr.dates.map((d) => (
                                  <option key={d} value={d}>
                                    {fmtDay(d)}
                                  </option>
                                ))}
                              </select>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {orgBookings.singles.length > 0 && (
                    <div className="text-xs uppercase tracking-wide text-slate-400 pt-2">Enkeltbookinger</div>
                  )}
                  {orgBookings.singles.map((b) => {
                    const picked = cancelTarget?.type === "single" && cancelTarget.booking.id === b.id;
                    return (
                      <button
                        key={b.id}
                        onClick={() => chooseCancelTarget({ type: "single", booking: b })}
                        className={`w-full text-left rounded-xl border px-4 py-3 ${
                          picked ? "border-blue-500 bg-blue-50/40" : "border-slate-200 hover:border-slate-300"
                        }`}
                      >
                        <div className="font-medium text-slate-800">
                          {fmtDay(b.date)} kl. {fmtTime(b.startTime)}-{fmtTime(b.endTime)}
                        </div>
                        <div className="text-xs text-slate-500">{b.facilityName}</div>
                      </button>
                    );
                  })}
                </div>
              )}

              {cancelTarget && (
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Besked til os (valgfrit)</label>
                  <textarea
                    value={cancelNotes}
                    onChange={(e) => setCancelNotes(e.target.value)}
                    rows={2}
                    placeholder="fx årsag eller ønske om en anden tid"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm"
                  />
                </div>
              )}

              <div className="flex gap-3">
                <button onClick={() => setStep("hvad")} className="flex-1 rounded-xl border border-slate-300 py-3 text-sm font-medium text-slate-700">
                  Tilbage
                </button>
                <button
                  onClick={submitCancellation}
                  disabled={!cancelTarget || busy || (cancelTarget.type === "series" && cancelScope !== "alt" && !cancelDate)}
                  className="flex-1 rounded-xl bg-red-600 text-white py-3 font-medium disabled:opacity-40"
                >
                  {busy ? "Sender..." : "Send anmodning"}
                </button>
              </div>
            </div>
          )}

          {step === "aflys_kvittering" && (
            <div className="space-y-4 text-center">
              <div className="text-4xl">&#128172;</div>
              <h2 className="font-semibold text-slate-900 text-lg">Anmodning sendt!</h2>
              <p className="text-sm text-slate-600">
                Vi har modtaget jeres anmodning om aflysning. Grenaa Idrætscenter behandler den hurtigst muligt, og I får
                en mail til {selectedOrg?.contactEmail}, når den er godkendt. Indtil da er bookingen stadig gældende.
              </p>
              <button
                onClick={() => {
                  setCancelTarget(null);
                  setStep("hvad");
                }}
                className="block w-full text-sm text-blue-600 font-medium"
              >
                Tilbage
              </button>
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
                <button onClick={() => setStep("hvad")} className="flex-1 rounded-xl border border-slate-300 py-3 text-sm font-medium text-slate-700">
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
              <div>
                <h2 className="font-semibold text-slate-900">Vælg dag og tid</h2>
                <p className="text-sm text-slate-500 mt-0.5">{selectedFacilities.map((f) => f.name).join(", ")}</p>
              </div>
              <SlotPicker
                facilityIds={Array.from(selectedFacilityIds)}
                audience="forening"
                allowRequests
                onChange={setSlot}
              />
              {slot && (
                <div
                  className={`rounded-xl border px-4 py-3 text-sm ${
                    slot.occupied ? "border-amber-200 bg-amber-50 text-amber-900" : "border-blue-200 bg-blue-50 text-blue-900"
                  }`}
                >
                  <div className="font-medium">
                    {fmtDay(slot.date)} · {slot.startTime}–{slot.endTime}
                  </div>
                  <div className={slot.occupied ? "text-amber-700" : "text-blue-700"}>
                    {slot.occupied
                      ? "Tiden er optaget - I sender en anmodning, som Grenaa Idrætscenter tager stilling til."
                      : "Tiden er ledig."}
                  </div>
                </div>
              )}
              <div className="flex gap-3">
                <button onClick={() => setStep("faciliteter")} className="flex-1 rounded-xl border border-slate-300 py-3 text-sm font-medium text-slate-700">
                  Tilbage
                </button>
                <button
                  disabled={!slot}
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
              {availability === "optaget" && (
                <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-xs text-amber-700">
                  Tiden er optaget af en anden booking. I kan sende en anmodning om at få den - Grenaa Idrætscenter
                  tager stilling til, om den anden booking kan flyttes eller aflyses, og I får besked om resultatet.
                </div>
              )}
              <div className="flex gap-3">
                <button onClick={() => setStep("dato")} className="flex-1 rounded-xl border border-slate-300 py-3 text-sm font-medium text-slate-700">
                  Tilbage
                </button>
                <button
                  onClick={submitBooking}
                  disabled={busy}
                  className={`flex-1 rounded-xl text-white py-3 font-medium disabled:opacity-40 ${
                    availability === "optaget" ? "bg-amber-600" : "bg-blue-600"
                  }`}
                >
                  {busy ? "Sender..." : availability === "optaget" ? "Anmod om aflysning/flytning" : "Bekræft booking"}
                </button>
              </div>
            </div>
          )}

          {step === "kvittering" && selectedDate && submissionType === "booking" && (
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

          {step === "kvittering" && selectedDate && submissionType === "anmodning" && (
            <div className="space-y-4 text-center">
              <div className="text-4xl">&#128172;</div>
              <h2 className="font-semibold text-slate-900 text-lg">Anmodning sendt!</h2>
              <div className="text-sm text-slate-600">
                {selectedFacilities.map((f) => f.name).join(", ")}
                <br />
                {formatDaDate(combineDateAndTime(selectedDate, startTime))}
                <br />
                {startTime} - {endTime}
              </div>
              <p className="text-sm text-slate-600">
                Tiden var desværre optaget i forvejen. Vi har sendt jeres anmodning til Grenaa Idrætscenter, som
                vender tilbage hurtigst muligt med besked om, hvorvidt I kan få tiden.
              </p>
              <a href="/book" className="block text-sm text-blue-600 font-medium">
                Tilbage til forsiden
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
