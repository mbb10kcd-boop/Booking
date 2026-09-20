"use client";

import { useState } from "react";
import type { BookingDTO, FacilityDTO, OrganizationDTO } from "@/lib/clientTypes";
import { formatDaDate, formatDaTime } from "@/lib/ai/messages";
import { roundDateTimeLocalString, stepDateTimeLocalString } from "@/lib/date";
import { WheelStepInput } from "./WheelStepInput";

const DEFAULT_FACILITY_COLOR = "#64748b";

// Beslutning: bookinger oprettet direkte af personalet her (i modsætning til
// dem der kommer via mailindbakken/portalen) er altid bekræftet med det
// samme - der er ikke brug for et separat status-felt i denne formular
// (fjernet efter feedback fra centeret, som ikke bruger de mellemliggende
// statusser fra GIBBS).
const DIRECT_BOOKING_STATUS = "bekraeftet";

function toLocalInput(iso: string) {
  return iso.slice(0, 16);
}

let slotKeySeq = 0;
function newSlotKey() {
  slotKeySeq += 1;
  return `slot_${slotKeySeq}`;
}

interface Slot {
  key: string;
  facilityId: string;
  start: string;
  end: string;
  saving: boolean;
  createdId?: string;
  /** Sat i stedet for `createdId` når slotten er oprettet som en sæsonbooking - antal ugentlige forekomster der blev oprettet. */
  createdCount?: number;
  /** Konflikt for en almindelig enkeltbooking (ét tidsrum). */
  conflicts?: BookingDTO[];
  /** Konflikter for en sæsonbooking - én liste af konflikter pr. dato der rammer en eksisterende booking. */
  seasonConflicts?: { date: string; conflicts: BookingDTO[] }[];
  /**
   * Ikke-blokerende bemærkninger for en almindelig enkeltbooking - fra løst
   * koblede faciliteter (fx klatrevæg/opvisningshal, se conflictMode "warn"
   * i src/lib/facilities.ts). Sættes kun ved succesfuld oprettelse, i
   * modsætning til `conflicts` som forhindrer oprettelsen.
   */
  warnings?: BookingDTO[];
  /** Samme som `warnings`, men for en sæsonbooking - grupperet pr. dato. */
  seasonWarnings?: { date: string; warnings: BookingDTO[] }[];
  error?: string;
}

export function BookingFormModal({
  facilities,
  organizations,
  defaultFacilityId,
  defaultStart,
  booking,
  onClose,
  onSaved,
}: {
  facilities: FacilityDTO[];
  organizations: OrganizationDTO[];
  defaultFacilityId?: string;
  defaultStart?: string;
  /** Angiv denne for at redigere en eksisterende booking i stedet for at oprette en ny. */
  booking?: BookingDTO;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEditing = !!booking;

  // Felter der er fælles for booking(er) - uanset om der oprettes én eller
  // flere faciliteter på samme tid (fx en hal og et mødelokale samtidig, så
  // man ikke skal taste kontaktoplysninger ind to gange).
  const [title, setTitle] = useState(booking?.title ?? "");
  const [organizationId, setOrganizationId] = useState(booking?.organizationId ?? "");
  const [contactName, setContactName] = useState(booking?.contactName ?? "");
  const [contactEmail, setContactEmail] = useState(booking?.contactEmail ?? "");
  const [notes, setNotes] = useState(booking?.notes ?? "");
  const [error, setError] = useState<string | null>(null);

  function selectOrganization(newId: string) {
    setOrganizationId(newId);
    // Foreslå automatisk foreningens registrerede kontaktperson (typisk
    // formanden) - men feltet forbliver frit redigerbart, fordi det ind
    // imellem er en anden end formanden, der booker og derfor skal have
    // bekræftelses-/aflysningsmailen.
    const org = organizations.find((o) => o.id === newId);
    if (org) {
      setContactName(org.contactName ?? "");
      setContactEmail(org.contactEmail ?? "");
    }
  }

  // ---------------------------------------------------------------------
  // Redigeringstilstand: én eksisterende booking, én facilitet/tidsrum.
  // ---------------------------------------------------------------------
  const [editFacilityId, setEditFacilityId] = useState(booking?.facilityId ?? "");
  const [editStart, setEditStart] = useState(booking ? toLocalInput(booking.startsAt) : "");
  const [editEnd, setEditEnd] = useState(booking ? toLocalInput(booking.endsAt) : "");
  const [editSaving, setEditSaving] = useState(false);
  const [editConflicts, setEditConflicts] = useState<BookingDTO[] | null>(null);
  /**
   * Ikke-blokerende bemærkning fra en løst koblet facilitet (fx
   * klatrevæg/opvisningshal). I modsætning til `editConflicts` forhindrer
   * dette ikke gemningen - sættes først NÅR ændringen allerede er gemt, og
   * bruges til at holde formularen åben (i stedet for straks at lukke via
   * `onSaved()`), så brugeren ser bemærkningen før de selv lukker den.
   */
  const [editWarnings, setEditWarnings] = useState<BookingDTO[] | null>(null);

  async function submitEdit(force: boolean) {
    if (!editFacilityId || !editStart || !editEnd) {
      setError("Udfyld facilitet, starttid og sluttid.");
      return;
    }
    setEditSaving(true);
    setError(null);
    setEditWarnings(null);
    const fallbackTitle = organizations.find((o) => o.id === organizationId)?.name ?? "Booking";
    const res = await fetch(`/api/bookings/${booking!.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        facilityId: editFacilityId,
        title: title || fallbackTitle,
        organizationId: organizationId || null,
        contactName: contactName || null,
        contactEmail: contactEmail || null,
        // datetime-local giver "YYYY-MM-DDTHH:mm" - vi gemmer altid naive
        // lokale klokkeslæt-strenge (se src/lib/date.ts), aldrig UTC/toISOString.
        startsAt: editStart.length === 16 ? `${editStart}:00` : editStart,
        endsAt: editEnd.length === 16 ? `${editEnd}:00` : editEnd,
        notes: notes || null,
        force,
        // Status røres slet ikke ved redigering - PATCH-endpointet bevarer
        // den eksisterende status uændret, når feltet udelades.
      }),
    });
    setEditSaving(false);
    if (res.status === 409) {
      const data = await res.json();
      setEditConflicts(data.conflicts);
      return;
    }
    if (!res.ok) {
      setError("Der opstod en fejl. Prøv igen.");
      return;
    }
    const data = await res.json();
    if (data.warnings && data.warnings.length > 0) {
      // Ændringen ER gemt allerede - dette er kun en bemærkning, ikke en
      // blokering, så vi holder formularen åben og lader brugeren selv lukke
      // den, i stedet for at kalde `onSaved()` med det samme.
      setEditWarnings(data.warnings);
      return;
    }
    onSaved();
  }

  // ---------------------------------------------------------------------
  // Oprettelsestilstand: én eller flere faciliteter/tidsrum på samme
  // booking (fx en hal OG et mødelokale samtidig), så man ikke skal
  // gentage titel/forening/kontakt for hver facilitet. Hver facilitet
  // bliver sin egen selvstændige booking i databasen, og kan derfor
  // efterfølgende redigeres eller aflyses hver for sig (fx hvis hallen
  // skal bruges i 3 timer, men mødelokalet kun i 2).
  // ---------------------------------------------------------------------
  const [slots, setSlots] = useState<Slot[]>(() => {
    const start = defaultStart ? toLocalInput(defaultStart) : "";
    return [
      {
        key: newSlotKey(),
        facilityId: defaultFacilityId ?? facilities[0]?.id ?? "",
        // Samme "start + 1 time"-forslag som handleSlotStartChange bruger,
        // når brugeren selv skifter starttidspunktet - så en booking der er
        // forudfyldt via dobbeltklik i kalenderen (se CalendarClient) også
        // får et fornuftigt sluttidspunkt foreslået med det samme.
        start,
        end: start ? stepDateTimeLocalString(start, 60) : "",
        saving: false,
      },
    ];
  });

  // Sæsonbooking: når afkrydset, oprettes hver facilitet/tidsrum ovenfor ikke
  // som én booking, men som én booking PR. UGE fra facilitetens starttidspunkt
  // og frem til og med `repeatUntil` - samme ugedag og klokkeslæt hver gang
  // (fx "hver tirsdag 16-18"). Gælder kun ved oprettelse af nye bookinger, ikke
  // ved redigering af en allerede oprettet enkelt forekomst - at redigere hele
  // en eksisterende sæson på én gang er ikke understøttet endnu.
  const [repeatWeekly, setRepeatWeekly] = useState(false);
  const [repeatUntil, setRepeatUntil] = useState("");

  // Sat til true når mindst én facilitet blev oprettet med en (ikke-blokerende)
  // bemærkning fra en løst koblet facilitet - da forhindrer vi den ellers
  // automatiske lukning af formularen efter oprettelse, så brugeren når at se
  // bemærkningen, og viser i stedet en eksplicit "Luk"-knap.
  const [createdWithWarnings, setCreatedWithWarnings] = useState(false);

  function updateSlot(key: string, patch: Partial<Slot>) {
    setSlots((prev) => prev.map((s) => (s.key === key ? { ...s, ...patch } : s)));
  }

  function addSlot() {
    setSlots((prev) => {
      // Ny facilitet arver dato/tidspunkt fra den FØRSTE facilitet (samme
      // logik som når man ændrer tidspunktet på den bagefter), ikke bare den
      // seneste - så man typisk kun skal taste tidspunktet én gang.
      const first = prev[0];
      const usedIds = new Set(prev.map((s) => s.facilityId));
      const nextFacility = facilities.find((f) => !f.archived && !usedIds.has(f.id)) ?? facilities[0];
      return [
        ...prev,
        {
          key: newSlotKey(),
          facilityId: nextFacility?.id ?? "",
          start: first?.start ?? "",
          end: first?.end ?? "",
          saving: false,
        },
      ];
    });
  }

  function removeSlot(key: string) {
    setSlots((prev) => prev.filter((s) => s.key !== key));
  }

  /**
   * Håndterer at brugeren ændrer starttidspunktet for én facilitet:
   * - sluttidspunktet for den samme facilitet foreslås automatisk som
   *   start + 1 time (langt de fleste bookinger er netop 1 time - man kan
   *   altid selv justere sluttiden bagefter, fx +/- et kvarter)
   * - er det den FØRSTE facilitet (index 0) der ændres, kopieres valget
   *   videre til de øvrige (endnu ikke oprettede) faciliteter, så man ikke
   *   skal indtaste samme dato/tid flere gange - hver af dem forbliver dog
   *   frit redigerbar bagefter (fx hvis hallen skal bruges længere end
   *   mødelokalet).
   */
  function handleSlotStartChange(index: number, value: string) {
    const newEnd = value ? stepDateTimeLocalString(value, 60) : "";
    setSlots((prev) =>
      prev.map((s, i) => {
        if (i === index) return { ...s, start: value, end: newEnd };
        if (index === 0 && !s.createdId) return { ...s, start: value, end: newEnd };
        return s;
      })
    );
  }

  async function createSingleSlot(slot: Slot, force: boolean): Promise<{ ok: boolean; hasWarnings: boolean }> {
    updateSlot(slot.key, {
      saving: true,
      error: undefined,
      conflicts: force ? slot.conflicts : undefined,
      warnings: undefined,
    });
    const fallbackTitle = organizations.find((o) => o.id === organizationId)?.name ?? "Booking";
    const res = await fetch("/api/bookings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        facilityId: slot.facilityId,
        title: title || fallbackTitle,
        organizationId: organizationId || null,
        contactName: contactName || null,
        contactEmail: contactEmail || null,
        startsAt: slot.start.length === 16 ? `${slot.start}:00` : slot.start,
        endsAt: slot.end.length === 16 ? `${slot.end}:00` : slot.end,
        notes: notes || null,
        status: DIRECT_BOOKING_STATUS,
        force,
      }),
    });
    if (res.status === 409) {
      const data = await res.json();
      updateSlot(slot.key, { saving: false, conflicts: data.conflicts });
      return { ok: false, hasWarnings: false };
    }
    if (!res.ok) {
      updateSlot(slot.key, { saving: false, error: "Der opstod en fejl. Prøv igen." });
      return { ok: false, hasWarnings: false };
    }
    const data = await res.json();
    const warnings: BookingDTO[] | undefined =
      data.warnings && data.warnings.length > 0 ? data.warnings : undefined;
    updateSlot(slot.key, {
      saving: false,
      createdId: data.booking.id,
      conflicts: undefined,
      error: undefined,
      warnings,
    });
    return { ok: true, hasWarnings: !!warnings };
  }

  /**
   * Opretter slotten som en sæsonbooking: én booking pr. ugentlig forekomst
   * fra slottens starttidspunkt og frem til og med `repeatUntil`, alle
   * grupperet under samme seasonGroupId (se /api/bookings/season). Ugedagen
   * behøver ikke angives særskilt - den udledes af starttidspunktets dato.
   */
  async function createSeasonSlot(slot: Slot, force: boolean): Promise<{ ok: boolean; hasWarnings: boolean }> {
    updateSlot(slot.key, {
      saving: true,
      error: undefined,
      seasonConflicts: force ? slot.seasonConflicts : undefined,
      seasonWarnings: undefined,
    });
    const fallbackTitle = organizations.find((o) => o.id === organizationId)?.name ?? "Booking";
    const res = await fetch("/api/bookings/season", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        facilityId: slot.facilityId,
        title: title || fallbackTitle,
        organizationId: organizationId || null,
        contactName: contactName || null,
        contactEmail: contactEmail || null,
        startDate: slot.start.slice(0, 10),
        startTime: slot.start.slice(11, 16),
        endTime: slot.end.slice(11, 16),
        until: repeatUntil,
        notes: notes || null,
        status: DIRECT_BOOKING_STATUS,
        force,
      }),
    });
    if (res.status === 409) {
      const data = await res.json();
      const seasonConflicts = Object.entries(data.conflictsByDate as Record<string, BookingDTO[]>)
        .map(([date, conflicts]) => ({ date, conflicts }))
        .sort((a, b) => a.date.localeCompare(b.date));
      updateSlot(slot.key, { saving: false, seasonConflicts });
      return { ok: false, hasWarnings: false };
    }
    if (!res.ok) {
      updateSlot(slot.key, { saving: false, error: "Der opstod en fejl. Prøv igen." });
      return { ok: false, hasWarnings: false };
    }
    const data = await res.json();
    const warningsByDate = data.warningsByDate as Record<string, BookingDTO[]> | undefined;
    const seasonWarnings =
      warningsByDate && Object.keys(warningsByDate).length > 0
        ? Object.entries(warningsByDate)
            .map(([date, warnings]) => ({ date, warnings }))
            .sort((a, b) => a.date.localeCompare(b.date))
        : undefined;
    updateSlot(slot.key, {
      saving: false,
      createdId: data.seasonGroupId,
      createdCount: data.createdBookingIds.length,
      seasonConflicts: undefined,
      error: undefined,
      seasonWarnings,
    });
    return { ok: true, hasWarnings: !!seasonWarnings };
  }

  async function createSlot(slot: Slot, force: boolean): Promise<{ ok: boolean; hasWarnings: boolean }> {
    if (!slot.facilityId || !slot.start || !slot.end) {
      updateSlot(slot.key, { error: "Udfyld facilitet, starttid og sluttid." });
      return { ok: false, hasWarnings: false };
    }
    if (repeatWeekly) {
      if (!repeatUntil) {
        updateSlot(slot.key, { error: "Angiv en slutdato for gentagelsen (\"Gentages til og med\")." });
        return { ok: false, hasWarnings: false };
      }
      if (repeatUntil < slot.start.slice(0, 10)) {
        updateSlot(slot.key, { error: "Slutdatoen for gentagelsen skal ligge efter startdatoen." });
        return { ok: false, hasWarnings: false };
      }
      return createSeasonSlot(slot, force);
    }
    return createSingleSlot(slot, force);
  }

  async function submitCreate() {
    setError(null);
    const pending = slots.filter((s) => !s.createdId);
    if (pending.length === 0) {
      onSaved();
      return;
    }
    // Bemærk: `ok` afgøres af createSlot's returværdi, IKKE ved bagefter at
    // læse `slots`-state igen - at kalde `onSaved()` (som lukker formularen
    // via en state-opdatering i CalendarClient) inde i et setSlots-callback
    // udløser Reacts "Cannot update a component while rendering a different
    // component"-advarsel, fordi det opdaterer en anden komponent midt i
    // beregningen af denne komponents eget state. Ved i stedet at samle
    // succes-status løbende under selve løkken, kan vi kalde `onSaved()` bagefter
    // som et almindeligt (ikke-render) sideeffekt af begivenheds-handleren.
    let allOk = true;
    let anyWarnings = false;
    for (const slot of pending) {
      // eslint-disable-next-line no-await-in-loop
      const result = await createSlot(slot, false);
      if (!result.ok) allOk = false;
      if (result.hasWarnings) anyWarnings = true;
    }
    if (!allOk) return;
    if (anyWarnings) {
      // Bookingen/bookingerne ER oprettet allerede - dette er kun en
      // bemærkning, ikke en blokering - så vi holder formularen åben og
      // lader brugeren se bemærkningen, i stedet for straks at kalde
      // `onSaved()`.
      setCreatedWithWarnings(true);
    } else {
      onSaved();
    }
  }

  const anySlotSaving = slots.some((s) => s.saving);
  const allSlotsCreated = slots.length > 0 && slots.every((s) => s.createdId);

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-slate-900/40 p-0 md:p-4 print:hidden">
      <div className="w-full md:max-w-lg bg-white rounded-t-2xl md:rounded-2xl shadow-xl max-h-[90vh] overflow-y-auto">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between sticky top-0 bg-white">
          <h3 className="font-semibold text-slate-900">{isEditing ? "Rediger booking" : "Ny booking"}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 text-xl leading-none">
            &times;
          </button>
        </div>

        <div className="p-5 space-y-4">
          {error && <div className="text-sm text-red-600">{error}</div>}

          {isEditing ? (
            <>
              {editConflicts && editConflicts.length > 0 && (
                <div className="rounded-xl border border-red-200 bg-red-50 p-4 space-y-2">
                  <div className="font-medium text-red-800 text-sm">Tiden konflikter med eksisterende booking(er):</div>
                  {editConflicts.map((c) => (
                    <div key={c.id} className="text-sm text-red-700">
                      {c.title} - {formatDaDate(c.startsAt)} {formatDaTime(c.startsAt)}-{formatDaTime(c.endsAt)}
                    </div>
                  ))}
                  <button
                    onClick={() => submitEdit(true)}
                    className="mt-2 w-full rounded-lg bg-red-600 text-white text-sm font-medium py-2 hover:bg-red-700"
                  >
                    Overskriv alligevel og gem
                  </button>
                </div>
              )}

              {editWarnings && editWarnings.length > 0 && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 space-y-2">
                  <div className="font-medium text-amber-800 text-sm">
                    Bemærk - tidspunktet overlapper med booking af en løst koblet facilitet:
                  </div>
                  {editWarnings.map((w) => (
                    <div key={w.id} className="text-sm text-amber-700">
                      {w.title} - {formatDaDate(w.startsAt)} {formatDaTime(w.startsAt)}-{formatDaTime(w.endsAt)}
                    </div>
                  ))}
                  <div className="text-xs text-amber-700">
                    Ændringen er gemt - dette er kun en bemærkning, ikke en blokering.
                  </div>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Facilitet</label>
                <div className="flex items-center gap-2">
                  <span
                    className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: facilities.find((f) => f.id === editFacilityId)?.color ?? DEFAULT_FACILITY_COLOR }}
                    aria-hidden
                  />
                  <select
                    value={editFacilityId}
                    onChange={(e) => setEditFacilityId(e.target.value)}
                    className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  >
                    {facilities
                      .filter((f) => !f.archived)
                      .map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.parentId ? "  – " : ""}
                          {f.name}
                        </option>
                      ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Start</label>
                  <WheelStepInput
                    type="datetime-local"
                    value={editStart}
                    onChange={setEditStart}
                    onRoundedBlur={roundDateTimeLocalString}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Slut</label>
                  <WheelStepInput
                    type="datetime-local"
                    value={editEnd}
                    onChange={setEditEnd}
                    onRoundedBlur={roundDateTimeLocalString}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
              </div>
            </>
          ) : (
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-sm font-medium text-slate-700">Faciliteter og tidspunkt(er)</label>
              </div>
              <div className="text-xs text-slate-500 mb-2">
                Skal I bruge flere lokaler samtidig (fx en hal og et mødelokale)? Tilføj dem her, så du kun skal
                udfylde kontaktoplysninger én gang - hver facilitet bliver sin egen booking bagefter, og kan
                redigeres for sig (fx med forskellig sluttid).
              </div>
              <div className="space-y-3">
                {slots.map((slot, index) => {
                  const facilityColor = facilities.find((f) => f.id === slot.facilityId)?.color ?? DEFAULT_FACILITY_COLOR;
                  return (
                  <div
                    key={slot.key}
                    className={`rounded-xl border p-3 space-y-2 ${
                      slot.createdId ? "border-green-200 bg-green-50" : "bg-slate-50/50"
                    }`}
                    style={slot.createdId ? undefined : { borderColor: facilityColor, borderLeftWidth: 4 }}
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: facilityColor }}
                        aria-hidden
                      />
                      <select
                        value={slot.facilityId}
                        disabled={!!slot.createdId}
                        onChange={(e) => updateSlot(slot.key, { facilityId: e.target.value })}
                        className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white disabled:opacity-60"
                      >
                        {facilities
                          .filter((f) => !f.archived)
                          .map((f) => (
                            <option key={f.id} value={f.id}>
                              {f.parentId ? "  – " : ""}
                              {f.name}
                            </option>
                          ))}
                      </select>
                      {slots.length > 1 && !slot.createdId && (
                        <button
                          onClick={() => removeSlot(slot.key)}
                          aria-label="Fjern facilitet"
                          className="text-slate-400 hover:text-red-600 text-lg leading-none px-1"
                        >
                          &times;
                        </button>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <WheelStepInput
                        type="datetime-local"
                        value={slot.start}
                        disabled={!!slot.createdId}
                        onChange={(v) => handleSlotStartChange(index, v)}
                        onRoundedBlur={roundDateTimeLocalString}
                        className="rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white disabled:opacity-60"
                      />
                      <WheelStepInput
                        type="datetime-local"
                        value={slot.end}
                        disabled={!!slot.createdId}
                        onChange={(v) => updateSlot(slot.key, { end: v })}
                        onRoundedBlur={roundDateTimeLocalString}
                        className="rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white disabled:opacity-60"
                      />
                    </div>
                    {slot.createdId && (
                      <div className="text-xs font-medium text-green-700">
                        {slot.createdCount ? `Oprettet (${slot.createdCount} forekomster)` : "Oprettet"}
                      </div>
                    )}
                    {slot.error && <div className="text-xs text-red-600">{slot.error}</div>}
                    {slot.conflicts && slot.conflicts.length > 0 && (
                      <div className="rounded-lg border border-red-200 bg-red-50 p-2.5 space-y-1.5">
                        <div className="font-medium text-red-800 text-xs">Konflikter med eksisterende booking(er):</div>
                        {slot.conflicts.map((c) => (
                          <div key={c.id} className="text-xs text-red-700">
                            {c.title} - {formatDaDate(c.startsAt)} {formatDaTime(c.startsAt)}-{formatDaTime(c.endsAt)}
                          </div>
                        ))}
                        <button
                          onClick={async () => {
                            const result = await createSlot(slot, true);
                            if (result.hasWarnings) setCreatedWithWarnings(true);
                          }}
                          disabled={slot.saving}
                          className="mt-1 w-full rounded-lg bg-red-600 text-white text-xs font-medium py-1.5 hover:bg-red-700 disabled:opacity-50"
                        >
                          {slot.saving ? "Gemmer..." : "Overskriv alligevel og opret"}
                        </button>
                      </div>
                    )}
                    {slot.warnings && slot.warnings.length > 0 && (
                      <div className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 space-y-1.5">
                        <div className="font-medium text-amber-800 text-xs">
                          Bemærk - overlapper med booking af en løst koblet facilitet:
                        </div>
                        {slot.warnings.map((w) => (
                          <div key={w.id} className="text-xs text-amber-700">
                            {w.title} - {formatDaDate(w.startsAt)} {formatDaTime(w.startsAt)}-{formatDaTime(w.endsAt)}
                          </div>
                        ))}
                      </div>
                    )}
                    {slot.seasonConflicts && slot.seasonConflicts.length > 0 && (
                      <div className="rounded-lg border border-red-200 bg-red-50 p-2.5 space-y-1.5">
                        <div className="font-medium text-red-800 text-xs">
                          {slot.seasonConflicts.length} af forekomsterne konflikter med eksisterende booking(er):
                        </div>
                        <div className="max-h-32 overflow-y-auto space-y-1.5">
                          {slot.seasonConflicts.map(({ date, conflicts }) => (
                            <div key={date}>
                              <div className="text-xs font-medium text-red-800">{formatDaDate(`${date}T00:00:00`)}</div>
                              {conflicts.map((c) => (
                                <div key={c.id} className="text-xs text-red-700 pl-2">
                                  {c.title} - {formatDaTime(c.startsAt)}-{formatDaTime(c.endsAt)}
                                </div>
                              ))}
                            </div>
                          ))}
                        </div>
                        <button
                          onClick={async () => {
                            const result = await createSlot(slot, true);
                            if (result.hasWarnings) setCreatedWithWarnings(true);
                          }}
                          disabled={slot.saving}
                          className="mt-1 w-full rounded-lg bg-red-600 text-white text-xs font-medium py-1.5 hover:bg-red-700 disabled:opacity-50"
                        >
                          {slot.saving ? "Gemmer..." : "Opret alligevel (også de forekomster der konflikter)"}
                        </button>
                      </div>
                    )}
                    {slot.seasonWarnings && slot.seasonWarnings.length > 0 && (
                      <div className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 space-y-1.5">
                        <div className="font-medium text-amber-800 text-xs">
                          {slot.seasonWarnings.length} af forekomsterne overlapper med booking af en løst koblet facilitet:
                        </div>
                        <div className="max-h-32 overflow-y-auto space-y-1.5">
                          {slot.seasonWarnings.map(({ date, warnings }) => (
                            <div key={date}>
                              <div className="text-xs font-medium text-amber-800">{formatDaDate(`${date}T00:00:00`)}</div>
                              {warnings.map((w) => (
                                <div key={w.id} className="text-xs text-amber-700 pl-2">
                                  {w.title} - {formatDaTime(w.startsAt)}-{formatDaTime(w.endsAt)}
                                </div>
                              ))}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                  );
                })}
              </div>
              <button
                onClick={addSlot}
                className="mt-2 text-sm text-blue-600 font-medium hover:text-blue-700"
              >
                + Tilføj facilitet
              </button>
              {slots.length > 1 && (
                <div className="mt-3 text-xs text-slate-500">
                  Titel og kontaktoplysninger nedenfor gælder for alle faciliteterne ovenfor.
                </div>
              )}

              <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50/50 p-3">
                <label className="flex items-center gap-2 text-sm font-medium text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={repeatWeekly}
                    onChange={(e) => setRepeatWeekly(e.target.checked)}
                    className="rounded border-slate-300"
                  />
                  Gentag ugentligt (sæsonbooking)
                </label>
                <div className="text-xs text-slate-500 mt-1">
                  Opretter en booking hver uge på samme ugedag og tidspunkt som angivet ovenfor - fx &quot;hver
                  tirsdag 16-18&quot; - fra startdatoen og frem til den valgte slutdato.
                </div>
                {repeatWeekly && (
                  <div className="mt-2">
                    <label className="block text-xs font-medium text-slate-700 mb-1">Gentages til og med</label>
                    <input
                      type="date"
                      value={repeatUntil}
                      onChange={(e) => setRepeatUntil(e.target.value)}
                      className="rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white"
                    />
                  </div>
                )}
              </div>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Titel</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Fx GIF Gymnastik - træning"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Forening (valgfri)</label>
            <select
              value={organizationId}
              onChange={(e) => selectOrganization(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="">Ingen</option>
              {organizations.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Kontaktnavn</label>
              <input
                value={contactName}
                onChange={(e) => setContactName(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Kontakt e-mail</label>
              <input
                value={contactEmail}
                onChange={(e) => setContactEmail(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Noter</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
        </div>

        <div className="px-5 py-4 border-t border-slate-100 flex gap-3 sticky bottom-0 bg-white">
          {isEditing && editWarnings && editWarnings.length > 0 ? (
            // Ændringen er allerede gemt - kun bemærkningen mangler at blive
            // set af brugeren, så der er intet at annullere eller gemme mere.
            <button
              onClick={onSaved}
              className="flex-1 rounded-lg bg-blue-600 py-2.5 text-sm font-medium text-white hover:bg-blue-700"
            >
              Luk
            </button>
          ) : !isEditing && allSlotsCreated && createdWithWarnings ? (
            // Samme situation ved oprettelse: bookingen/bookingerne er
            // allerede oprettet, og vi venter blot på at brugeren har set
            // bemærkningen/bemærkningerne ovenfor.
            <button
              onClick={onSaved}
              className="flex-1 rounded-lg bg-blue-600 py-2.5 text-sm font-medium text-white hover:bg-blue-700"
            >
              Luk
            </button>
          ) : (
            <>
              <button onClick={onClose} className="flex-1 rounded-lg border border-slate-300 py-2.5 text-sm font-medium text-slate-700">
                Annullér
              </button>
              {isEditing ? (
                <button
                  onClick={() => submitEdit(false)}
                  disabled={editSaving}
                  className="flex-1 rounded-lg bg-blue-600 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {editSaving ? "Gemmer..." : "Gem ændringer"}
                </button>
              ) : (
                <button
                  onClick={submitCreate}
                  disabled={anySlotSaving || allSlotsCreated}
                  className="flex-1 rounded-lg bg-blue-600 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {anySlotSaving
                    ? "Gemmer..."
                    : allSlotsCreated
                    ? "Oprettet"
                    : repeatWeekly
                    ? slots.length > 1
                      ? "Opret sæsonbookinger"
                      : "Opret sæsonbooking"
                    : slots.length > 1
                    ? "Opret bookinger"
                    : "Opret booking"}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
