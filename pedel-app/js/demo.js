// DEMO-DATA. Kun i hukommelsen - rører aldrig det rigtige bookingsystem.
// Alle navne, telefonnumre og bookinger her er opdigtede.
import { addDaysStr, todayStr, nowLocal } from "./util.js";
import { ApiError } from "./api.js";

const F = (id, name, color, parentId = null) => ({ id, name, color, parentId, description: null, conflictMode: "block", archived: false, sortOrder: 0 });
const facilities = [
  F("f_opv", "Opvisningshallen", "#2563eb"),
  F("f_tra", "Træningshallen", "#b7791f"),
  F("f_bad1", "Badmintonbane 1", "#0d9488", "f_tra"),
  F("f_bad2", "Badmintonbane 2", "#0d9488", "f_tra"),
  F("f_mul", "Multisalen", "#c026d3"),
  F("f_mod", "Mødelokale", "#64748b"),
];
const orgs = [
  { id: "o_1", name: "Demo Håndboldklub", contactName: "Anders Demo", contactPhone: "00 00 00 01", contactEmail: null, internal: false },
  { id: "o_2", name: "Demo Badmintonklub", contactName: "Birgit Demo", contactPhone: "00 00 00 02", contactEmail: null, internal: false },
  { id: "o_3", name: "Demo Gymnastikforening", contactName: "Carsten Demo", contactPhone: "00 00 00 03", contactEmail: null, internal: false },
  { id: "o_gic", name: "GIC (internt demo)", contactName: "Pedel Demo", contactPhone: null, contactEmail: null, internal: true },
];

let seq = 100;
const now = nowLocal();
function stamp(daysAgo, h = 9) { // UTC-lignende tidsstempel "YYYY-MM-DD HH:MM:SS"
  const d = new Date(Date.now() - daysAgo * 86400000 - (new Date().getHours() - h) * 3600000);
  return d.toISOString().slice(0, 19).replace("T", " ");
}
function B(day, from, to, facilityId, title, o = {}) {
  const org = o.org ? orgs.find((x) => x.id === o.org) : null;
  return {
    id: "demo_" + ++seq, facilityId, organizationId: o.org ?? null, title,
    contactName: o.contact ?? org?.contactName ?? null, contactEmail: null, contactPhone: o.phone ?? org?.contactPhone ?? null,
    startsAt: `${addDaysStr(todayStr(), day)}T${from}:00`,
    endsAt: `${addDaysStr(todayStr(), o.endDay ?? day)}T${to}:00`,
    status: o.status ?? "bekraeftet", seasonGroupId: o.season ? "season_demo" : null, recurrenceRule: null,
    price: 0, paymentStatus: "ikke_paakraevet", accessCode: o.code ?? null, extraEmail: null,
    notes: o.notes ?? null, source: "manuel", important: !!o.important, multiBookingGroupId: null,
    cancelledAt: o.status === "aflyst" ? now : null, cancelReason: o.reason ?? null,
    movedFromFacilityId: o.movedFrom ?? null, movedFromStartsAt: o.movedFrom ? `${addDaysStr(todayStr(), day)}T${from}:00` : null, movedFromEndsAt: null,
    createdAt: stamp(o.createdDaysAgo ?? 30), updatedAt: stamp(o.updatedDaysAgo ?? o.createdDaysAgo ?? 30),
  };
}
const hh = (n) => String(n).padStart(2, "0");
const nowH = Number(now.slice(11, 13));
const bookings = [
  B(0, "08:00", "10:00", "f_opv", "Morgentræning", { org: "o_3", season: true }),
  B(0, `${hh(Math.max(nowH - 1, 6))}:00`, `${hh(Math.min(nowH + 1, 23))}:00`, "f_tra", "Håndbold U12 (kører nu)", { org: "o_1", season: true, notes: "Husk at låse mål-lageret op." }),
  B(0, `${hh(Math.min(nowH + 2, 21))}:00`, `${hh(Math.min(nowH + 4, 23))}:30`, "f_bad1", "Badminton, motion", { org: "o_2", season: true }),
  B(0, `${hh(Math.min(nowH + 3, 21))}:00`, `${hh(Math.min(nowH + 5, 23))}:00`, "f_mul", "Fødselsdag – opstilling af borde", { contact: "Dorte Demo", phone: "00 00 00 04", notes: "20 børn. Borde og stole ud inden kl. 14.", createdDaysAgo: 1 }),
  B(0, "17:00", "18:00", "f_mod", "Bestyrelsesmøde", { org: "o_gic", status: "aflyst", reason: "Udsat til næste uge" }),
  B(1, "16:00", "18:00", "f_opv", "Håndboldkamp U14", { org: "o_1", important: true, notes: "Kampdag – dommerrum åbnes 15.30." }),
  B(1, "18:00", "20:00", "f_tra", "Gymnastik, springhold", { org: "o_3", season: true, movedFrom: "f_opv", updatedDaysAgo: 0, createdDaysAgo: 40 }),
  B(2, "09:00", "12:00", "f_mul", "Kursus – demo", { contact: "Erik Demo", phone: "00 00 00 05", status: "reserveret" }),
  B(3, "10:00", "20:00", "f_opv", "Demo Cup (flerdags)", { contact: "Fie Demo", phone: "00 00 00 06", endDay: 5, createdDaysAgo: 2, notes: "Opstilling af 4 baner torsdag aften." }),
  B(4, "17:00", "19:00", "f_bad2", "Badminton, ungdom", { org: "o_2", season: true }),
];

let nextId = 1;
const clone = (x) => JSON.parse(JSON.stringify(x));
const delay = (v) => new Promise((r) => setTimeout(() => r(clone(v)), 120));
const overlaps = (aS, aE, bS, bE) => aS < bE && bS < aE;
const related = (a, b) => {
  if (a === b) return true;
  const fa = facilities.find((f) => f.id === a), fb = facilities.find((f) => f.id === b);
  return fa?.parentId === b || fb?.parentId === a;
};
function conflictsFor(p) {
  return bookings.filter((b) => !["aflyst", "afvist"].includes(b.status) && b.id !== p.excludeBookingId
    && related(b.facilityId, p.facilityId) && overlaps(p.startsAt, p.endsAt, b.startsAt, b.endsAt));
}

export const api = {
  me: async () => ({ id: "demo", name: "Demo-pedel", email: "demo@example.invalid", role: "pedel" }),
  login: async () => api.me(),
  logout: async () => ({ ok: true }),
  facilities: () => delay(facilities),
  organizations: () => delay(orgs),
  bookings: (from, to) => delay(bookings.filter((b) => b.endsAt >= from && b.startsAt <= to)),
  booking: async (id) => {
    const b = bookings.find((x) => x.id === id);
    if (!b) throw new ApiError(404, { error: "Ikke fundet" });
    const history = [{ id: "h1", action: "oprettet", actorName: "Demo", detail: "oprettet (demo)", createdAt: b.createdAt }];
    if (b.status === "aflyst") history.push({ id: "h2", action: "aflyst", actorName: "Demo", detail: "", createdAt: b.updatedAt });
    else if (b.updatedAt !== b.createdAt) history.push({ id: "h2", action: "opdateret", actorName: "Demo", detail: "", createdAt: b.updatedAt });
    return clone({ ...b, history });
  },
  dayNotes: (from, to) => delay([{ id: "n1", date: todayStr(), text: "Demo-note: Tekniker kommer til ventilationen kl. 10.", createdBy: "Demo" }].filter((n) => n.date >= from && n.date <= to)),
  checkConflict: async (p) => {
    const c = conflictsFor(p);
    if (!c.length) return delay({ status: "ledig", conflicts: [] });
    const toMin = (iso) => Number(iso.slice(11, 13)) * 60 + Number(iso.slice(14, 16));
    const dur = toMin(p.endsAt) - toMin(p.startsAt);
    const alts = [];
    for (let m = 7 * 60; m + dur <= 22 * 60 && alts.length < 3; m += 30) {
      const s = `${p.startsAt.slice(0, 10)}T${hh(Math.floor(m / 60))}:${hh(m % 60)}:00`;
      const e = `${p.startsAt.slice(0, 10)}T${hh(Math.floor((m + dur) / 60))}:${hh((m + dur) % 60)}:00`;
      if (!conflictsFor({ ...p, startsAt: s, endsAt: e }).length) alts.push({ startsAt: s, endsAt: e });
    }
    const altFac = facilities.filter((f) => !f.parentId && f.id !== p.facilityId && !conflictsFor({ ...p, facilityId: f.id }).length).map((f) => f.id);
    return delay({ status: "konflikt", conflicts: c, suggestions: { alternativeTimes: alts, alternativeFacilityIds: altFac } });
  },
  create: async (p) => {
    const c = conflictsFor(p);
    if (c.length) throw new ApiError(409, { error: "konflikt", conflicts: clone(c) });
    const b = { ...B(0, "00:00", "00:00", p.facilityId, p.title), ...p, id: "demo_new_" + nextId++, status: p.status ?? "bekraeftet", createdAt: stamp(0), updatedAt: stamp(0), cancelledAt: null, cancelReason: null, accessCode: null, seasonGroupId: null };
    delete b.force;
    bookings.push(b);
    return delay({ booking: b, overriddenConflicts: [], warnings: [] });
  },
  update: async (id, p) => {
    const b = bookings.find((x) => x.id === id);
    if (!b) throw new ApiError(404, { error: "Ikke fundet" });
    const next = { ...b, ...p };
    const c = conflictsFor({ facilityId: next.facilityId, startsAt: next.startsAt, endsAt: next.endsAt, excludeBookingId: id });
    if (c.length) throw new ApiError(409, { error: "konflikt", conflicts: clone(c) });
    Object.assign(b, p, { updatedAt: stamp(0) });
    delete b.force;
    return delay({ ...b, warnings: [] });
  },
  cancel: async (id, reason) => {
    const b = bookings.find((x) => x.id === id);
    if (!b) throw new ApiError(404, { error: "Ikke fundet" });
    Object.assign(b, { status: "aflyst", cancelledAt: nowLocal(), cancelReason: reason || null, updatedAt: stamp(0) });
    return delay({ ok: true });
  },
};
