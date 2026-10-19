// Opret og rediger booking. Bruger de eksisterende endpoints og regler:
//  - POST /api/bookings (opret), PATCH /api/bookings/:id (ret), POST /api/bookings/check-conflict (konflikttjek).
//  - Konflikter blokerer her (ingen "tving igennem" for pedeller) - vælg et andet tidspunkt/lokale.
import { api, ApiError, isDemo } from "./api.js";
import { esc, todayStr, nowLocal, hhmm, fmtDateShort, fmtDateLongCap } from "./util.js";
import { icon, loadRef, ref, facName, toast, errorBox, skeleton } from "./ui.js";

const pad = (n) => String(n).padStart(2, "0");
function addMinutes(time, mins) {
  const [h, m] = time.split(":").map(Number);
  const t = Math.min(h * 60 + m + mins, 23 * 60 + 59);
  return `${pad(Math.floor(t / 60))}:${pad(t % 60)}`;
}
function defaultStart() {
  const n = nowLocal();
  let h = Number(n.slice(11, 13)) + 1;
  if (h < 8) h = 8;
  if (h > 21) h = 21;
  return `${pad(h)}:00`;
}
const lastFacKey = "pedel-last-facility";
const getLast = () => { try { return localStorage.getItem(lastFacKey); } catch { return null; } };
const setLast = (v) => { try { localStorage.setItem(lastFacKey, v); } catch { /* ignorer */ } };

export async function renderForm(deps, { mode, query, id }) {
  const { shell, setView, userMessage, handleAuth, invalidateCache, bust, getToken } = deps;
  const token = bust();
  const editing = mode === "edit";
  setView(shell(editing ? "list" : "create", `<div class="page narrow">${skeleton(2)}</div>`, { back: editing ? `#/booking/${encodeURIComponent(id)}` : "#/" }));
  let booking = null;
  try {
    await loadRef();
    if (editing) booking = await api.booking(id);
  } catch (err) {
    if (token !== getToken() || handleAuth(err)) return;
    setView(shell(editing ? "list" : "create", `<div class="page narrow">${errorBox(userMessage(err))}</div>`, { back: "#/" }));
    return;
  }
  if (token !== getToken()) return;
  if (editing && (booking.status === "aflyst" || booking.status === "afvist")) {
    setView(shell("list", `<div class="page narrow"><div class="notice n-error">${icon("x")}<div><strong>Aflyste bookinger kan ikke redigeres</strong><p>Opret en ny booking i stedet.</p><a class="btn small" href="#/booking/${encodeURIComponent(id)}">Til bookingen</a></div></div></div>`, { back: `#/booking/${encodeURIComponent(id)}` }));
    return;
  }

  const q = new URLSearchParams(query || "");
  const topFacs = ref.facList.filter((f) => !f.parentId);
  const f = editing
    ? {
        facilityId: booking.facilityId, date: booking.startsAt.slice(0, 10), start: booking.startsAt.slice(11, 16),
        endDate: booking.endsAt.slice(0, 10), end: booking.endsAt.slice(11, 16),
        multi: booking.endsAt.slice(0, 10) !== booking.startsAt.slice(0, 10) && booking.endsAt.slice(11, 16) !== "00:00",
        title: booking.title, orgId: booking.organizationId || "", contact: booking.contactName || "", phone: booking.contactPhone || "",
        notes: booking.notes || "", important: !!booking.important,
      }
    : (() => {
        const start = defaultStart();
        const fid = q.get("facility") || getLast();
        const date = q.get("date") || todayStr();
        return {
          facilityId: ref.fac.has(fid) ? fid : topFacs[0]?.id || "", date, start, endDate: date, end: addMinutes(start, 60), multi: false,
          title: "", orgId: "", contact: "", phone: "", notes: "", important: false,
        };
      })();

  const facOptions = (sel) => topFacs.map((p) => {
    const kids = ref.facList.filter((c) => c.parentId === p.id);
    return `<option value="${esc(p.id)}" ${p.id === sel ? "selected" : ""}>${esc(p.name)}</option>${kids.map((c) => `<option value="${esc(c.id)}" ${c.id === sel ? "selected" : ""}>– ${esc(c.name)}</option>`).join("")}`;
  }).join("") + ref.facList.filter((x) => x.parentId && !ref.fac.has(x.parentId)).map((c) => `<option value="${esc(c.id)}" ${c.id === sel ? "selected" : ""}>${esc(c.name)}</option>`).join("");

  const orgOptions = `<option value="">– Ingen forening –</option>${ref.orgList.map((o) => `<option value="${esc(o.id)}" ${o.id === f.orgId ? "selected" : ""}>${esc(o.name)}</option>`).join("")}`;

  setView(shell(editing ? "list" : "create", `<div class="page narrow">
    <h1 class="page-title">${editing ? "Rediger booking" : "Opret booking"}</h1>
    ${isDemo() ? `<div class="notice n-warn">${icon("warn")}<div>Demo-tilstand: Bookingen gemmes kun i denne session.</div></div>` : ""}
    ${editing && booking.seasonGroupId ? `<div class="notice n-info">${icon("repeat")}<div>Denne booking er en del af en sæson. Ændringen gælder kun denne dag.</div></div>` : ""}
    <div id="form-error"></div>
    <form id="bk-form" novalidate>
      <fieldset class="fs"><legend>Hvor og hvornår</legend>
        <label class="field"><span>Lokale *</span><select id="f-fac" name="facility">${facOptions(f.facilityId)}</select><p class="err" id="err-fac" hidden></p></label>
        <label class="field"><span>Dato *</span><input type="date" id="f-date" value="${esc(f.date)}"><p class="err" id="err-date" hidden></p></label>
        <div class="row2">
          <label class="field"><span>Fra *</span><input type="time" id="f-start" value="${esc(f.start)}" step="300"><p class="err" id="err-start" hidden></p></label>
          <label class="field"><span>Til *</span><input type="time" id="f-end" value="${esc(f.end)}" step="300"><p class="err" id="err-end" hidden></p></label>
        </div>
        <div class="chips" role="group" aria-label="Hurtigt valg af varighed"><span>Varighed:</span>
          ${[[60, "1 t"], [90, "1,5 t"], [120, "2 t"], [180, "3 t"]].map(([m, l]) => `<button type="button" class="chip" data-dur="${m}">${l}</button>`).join("")}</div>
        <label class="check"><input type="checkbox" id="f-multi" ${f.multi ? "checked" : ""}><span>Løber over flere dage</span></label>
        <label class="field" id="enddate-wrap" ${f.multi ? "" : "hidden"}><span>Slutdato</span><input type="date" id="f-enddate" value="${esc(f.endDate)}"><p class="err" id="err-enddate" hidden></p></label>
        <div id="conflict" class="conflict" aria-live="polite"></div>
      </fieldset>
      <fieldset class="fs"><legend>Hvad og hvem</legend>
        <label class="field"><span>Aktivitet / titel</span><input type="text" id="f-title" value="${esc(f.title)}" maxlength="120" placeholder="fx Håndboldtræning" autocomplete="off"><p class="err" id="err-title" hidden></p></label>
        <label class="field"><span>Forening</span><select id="f-org">${orgOptions}</select></label>
        <p class="hint" id="org-mail" hidden></p>
        <label class="field"><span>Ansvarlig</span><input type="text" id="f-contact" value="${esc(f.contact)}" maxlength="80" autocomplete="off"></label>
        <label class="field"><span>Telefon</span><input type="tel" id="f-phone" value="${esc(f.phone)}" maxlength="30" inputmode="tel" autocomplete="off"></label>
        <label class="field"><span>Praktiske noter</span><textarea id="f-notes" rows="3" maxlength="500" placeholder="fx Opstilling af borde, nøgle, særlige ønsker">${esc(f.notes)}</textarea></label>
        <label class="check"><input type="checkbox" id="f-important" ${f.important ? "checked" : ""}><span>${icon("flag")} Markér som vigtig/kamp</span></label>
      </fieldset>
      ${editing ? `<p class="hint">Ændres tid eller lokale, får kontaktpersonen besked på mail (hvis der er en mailadresse).</p>` : ""}
      <div class="form-actions">
        <a class="btn" href="${editing ? `#/booking/${encodeURIComponent(id)}` : "#/"}">Annullér</a>
        <button class="btn primary" type="submit" id="save-btn">${editing ? "Gem ændringer" : "Gem booking"}</button>
      </div>
    </form></div>`, { back: editing ? `#/booking/${encodeURIComponent(id)}` : "#/" }));

  const $ = (s) => document.querySelector(s);
  const el = { fac: $("#f-fac"), date: $("#f-date"), start: $("#f-start"), end: $("#f-end"), multi: $("#f-multi"), endDate: $("#f-enddate"), title: $("#f-title"), org: $("#f-org"), contact: $("#f-contact"), phone: $("#f-phone"), notes: $("#f-notes"), important: $("#f-important") };
  let checkSeq = 0, checkTimer = null, conflictState = "unknown";

  const endDateVal = () => (el.multi.checked ? el.endDate.value || el.date.value : el.date.value);
  const startsAt = () => `${el.date.value}T${el.start.value}:00`;
  const endsAt = () => `${endDateVal()}T${el.end.value}:00`;
  const timesValid = () => el.date.value && el.start.value && el.end.value && endsAt() > startsAt();

  function setErr(id, msg) {
    const p = document.getElementById("err-" + id);
    if (!p) return;
    p.textContent = msg || ""; p.hidden = !msg;
    p.closest(".field")?.classList.toggle("invalid", !!msg);
  }
  function validate() {
    let first = null;
    const fail = (id, msg, input) => { setErr(id, msg); if (!first) first = input; };
    ["fac", "date", "start", "end", "enddate", "title"].forEach((k) => setErr(k, ""));
    if (!el.fac.value) fail("fac", "Vælg et lokale.", el.fac);
    if (!el.date.value) fail("date", "Vælg en dato.", el.date);
    if (!el.start.value) fail("start", "Angiv starttid.", el.start);
    if (!el.end.value) fail("end", "Angiv sluttid.", el.end);
    if (el.date.value && el.start.value && el.end.value && endsAt() <= startsAt()) fail("end", "Sluttid skal være efter starttid.", el.end);
    if (!el.title.value.trim() && !el.org.value) fail("title", "Skriv en titel, eller vælg en forening.", el.title);
    if (!editing && el.date.value && el.date.value < todayStr()) fail("date", "Datoen ligger i fortiden.", el.date);
    return first;
  }

  function scheduleCheck() {
    clearTimeout(checkTimer);
    const box = $("#conflict");
    if (!el.fac.value || !timesValid()) { conflictState = "unknown"; box.innerHTML = ""; return; }
    box.innerHTML = `<div class="cf cf-wait">${icon("clock")}Tjekker om tiden er ledig …</div>`;
    checkTimer = setTimeout(runCheck, 450);
  }
  async function runCheck() {
    const seq = ++checkSeq;
    const box = $("#conflict");
    if (!box) return;
    try {
      const res = await api.checkConflict({ facilityId: el.fac.value, startsAt: startsAt(), endsAt: endsAt(), excludeBookingId: editing ? id : undefined });
      if (seq !== checkSeq) return;
      showConflict(res);
    } catch (err) {
      if (seq !== checkSeq) return;
      conflictState = "unknown";
      box.innerHTML = `<div class="cf cf-wait">${icon("warn")}Kunne ikke tjekke for konflikter lige nu. Systemet tjekker igen, når du gemmer.</div>`;
    }
  }
  function showConflict(res) {
    const box = $("#conflict");
    if (res.status !== "konflikt") { conflictState = "free"; box.innerHTML = `<div class="cf cf-free">${icon("check")}Tiden er ledig</div>`; return; }
    conflictState = "conflict";
    const list = (res.conflicts || []).map((c) => `<li><strong>${esc(hhmm(c.startsAt))}–${esc(hhmm(c.endsAt))}</strong> ${esc(c.title)} <small>(${esc(facName(c.facilityId))}${c.startsAt.slice(0, 10) !== el.date.value ? ", " + esc(fmtDateShort(c.startsAt.slice(0, 10))) : ""})</small></li>`).join("");
    const alts = res.suggestions?.alternativeTimes || [];
    const altF = res.suggestions?.alternativeFacilityIds || [];
    box.innerHTML = `<div class="cf cf-busy" role="alert">${icon("x")}<div><strong>Tiden er optaget</strong><ul>${list}</ul>
      ${alts.length ? `<p class="cf-h">Ledige tidspunkter samme dag:</p><div class="chips">${alts.map((a) => `<button type="button" class="chip" data-alt-start="${esc(a.startsAt.slice(11, 16))}" data-alt-end="${esc(a.endsAt.slice(11, 16))}">${esc(hhmm(a.startsAt))}–${esc(hhmm(a.endsAt))}</button>`).join("")}</div>` : ""}
      ${altF.length ? `<p class="cf-h">Andre ledige lokaler i samme tidsrum:</p><div class="chips">${altF.map((fid) => `<button type="button" class="chip" data-alt-fac="${esc(fid)}">${esc(facName(fid))}</button>`).join("")}</div>` : ""}</div></div>`;
  }

  function updateOrgHint() {
    const o = ref.orgs.get(el.org.value);
    const h = $("#org-mail");
    if (!editing && o?.contactEmail) { h.hidden = false; h.textContent = "Foreningen får en bekræftelse på mail, når bookingen er oprettet."; } else h.hidden = true;
  }

  document.getElementById("bk-form").addEventListener("input", (e) => {
    const t = e.target;
    if (t === el.start && !editing && el.start.value) {
      // behold varigheden, når starttid ændres på en ny booking
      const dur = durationMin();
      if (dur > 0) el.end.value = addMinutes(el.start.value, dur);
    }
    lastDur = timesValid() ? durationMin() : lastDur;
    if (t === el.multi) $("#enddate-wrap").hidden = !el.multi.checked;
    if (t === el.date && !el.multi.checked) el.endDate.value = el.date.value;
    if (t === el.date && el.multi.checked && el.endDate.value < el.date.value) el.endDate.value = el.date.value;
    if ([el.fac, el.date, el.start, el.end, el.multi, el.endDate].includes(t)) scheduleCheck();
    if (t.classList?.contains("invalid") || t.closest(".field")?.classList.contains("invalid")) validate();
  });
  let lastDur = 60;
  function durationMin() {
    if (!el.start.value || !el.end.value) return lastDur;
    const [sh, sm] = el.start.value.split(":").map(Number), [eh, em] = el.end.value.split(":").map(Number);
    return eh * 60 + em - (sh * 60 + sm);
  }
  el.org.addEventListener("change", () => {
    const o = ref.orgs.get(el.org.value);
    if (o) {
      if (!el.contact.value.trim() && o.contactName) el.contact.value = o.contactName;
      if (!el.phone.value.trim() && o.contactPhone) el.phone.value = o.contactPhone;
    }
    updateOrgHint();
    el.title.placeholder = o ? o.name : "fx Håndboldtræning";
  });

  document.getElementById("bk-form").addEventListener("click", (e) => {
    const dur = e.target.closest("[data-dur]");
    if (dur && el.start.value) { el.end.value = addMinutes(el.start.value, Number(dur.dataset.dur)); lastDur = Number(dur.dataset.dur); setErr("end", ""); scheduleCheck(); return; }
    const as = e.target.closest("[data-alt-start]");
    if (as) { el.start.value = as.dataset.altStart; el.end.value = as.dataset.altEnd; scheduleCheck(); return; }
    const af = e.target.closest("[data-alt-fac]");
    if (af) { el.fac.value = af.dataset.altFac; scheduleCheck(); }
  });

  function payload() {
    const o = ref.orgs.get(el.org.value);
    const base = {
      facilityId: el.fac.value,
      title: el.title.value.trim() || o?.name || "Booking",
      organizationId: el.org.value || null,
      contactName: el.contact.value.trim() || null,
      contactPhone: el.phone.value.trim() || null,
      startsAt: startsAt(), endsAt: endsAt(),
      notes: el.notes.value.trim() || null,
      important: el.important.checked,
    };
    if (!editing) {
      // Som i admin-kalenderen: foreningens mail bruges til bekræftelsen, hvis den findes.
      if (o?.contactEmail) base.contactEmail = o.contactEmail;
      Object.assign(base, { status: "bekraeftet", source: "pedel", createdBy: deps.getUser()?.name || "Pedel" });
    }
    return base;
  }

  document.getElementById("bk-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const errBox = document.getElementById("form-error");
    errBox.innerHTML = "";
    const bad = validate();
    if (bad) { bad.focus(); bad.scrollIntoView({ block: "center", behavior: "smooth" }); return; }
    const btn = $("#save-btn");
    btn.disabled = true; btn.classList.add("busy");
    try {
      if (editing) {
        const res = await api.update(id, payload());
        invalidateCache();
        setLast(el.fac.value);
        toast("Ændringerne er gemt");
        if (res.warnings?.length) sessionStorage.setItem("pedel-warn", warnText(res.warnings));
        location.hash = `#/booking/${encodeURIComponent(id)}`;
      } else {
        const res = await api.create(payload());
        invalidateCache();
        setLast(el.fac.value);
        showSuccess(res);
      }
    } catch (err) {
      btn.disabled = false; btn.classList.remove("busy");
      if (handleAuth(err)) return;
      if (err instanceof ApiError && err.status === 409) {
        conflictState = "conflict";
        errBox.innerHTML = `<div class="notice n-error" role="alert">${icon("x")}<div><strong>Bookingen blev ikke gemt</strong><p>Tiden er optaget. Vælg et andet tidspunkt eller lokale.</p></div></div>`;
        showConflict({ status: "konflikt", conflicts: err.data?.conflicts || [] });
        runCheck();
      } else {
        errBox.innerHTML = `<div class="notice n-error" role="alert">${icon("warn")}<div><strong>Bookingen blev ikke gemt</strong><p>${esc(userMessage(err))}</p></div></div>`;
      }
      errBox.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  });

  function warnText(ws) { return ws.map((w) => `${w.title} (${facName(w.facilityId)}) bruger et tilknyttet lokale samtidig`).join("; "); }

  function showSuccess(res) {
    const b = res.booking;
    const warn = res.warnings?.length ? `<div class="notice n-warn">${icon("warn")}<div><strong>Bemærk</strong><p>${esc(warnText(res.warnings))}.</p></div></div>` : "";
    const container = document.querySelector(".page");
    container.innerHTML = `<div class="success">
      <div class="success-ic">${icon("check")}</div>
      <h1>Bookingen er oprettet</h1>
      <div class="panel sum"><strong>${esc(b.title)}</strong><br>${esc(fmtDateLongCap(b.startsAt.slice(0, 10)))}<br>${esc(hhmm(b.startsAt))}–${esc(hhmm(b.endsAt))} · ${esc(facName(b.facilityId))}</div>
      ${warn}
      <div class="actions col">
        <a class="btn primary" href="#/booking/${encodeURIComponent(b.id)}">Se booking</a>
        <a class="btn" href="#/opret?facility=${encodeURIComponent(b.facilityId)}&date=${b.startsAt.slice(0, 10)}" id="again">Opret endnu en</a>
        <a class="btn ghost" href="#/">Til I dag</a>
      </div></div>`;
    toast("Booking oprettet");
    window.scrollTo(0, 0);
    const again = document.getElementById("again");
    again.addEventListener("click", () => { if (location.hash === again.getAttribute("href")) window.dispatchEvent(new HashChangeEvent("hashchange")); });
  }

  updateOrgHint();
  scheduleCheck();
}
