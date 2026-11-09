// API-lag. Kalder det EKSISTERENDE bookingsystem (samme endpoints som admin-kalenderen).
// På Netlify videresendes /api/* til bookingsystemet (se netlify.toml), så login-cookien
// ligger på samme domæne som appen, og der ikke er brug for CORS eller hemmeligheder i frontend.
export class ApiError extends Error {
  constructor(status, data) { super(data?.error || `Fejl ${status}`); this.status = status; this.data = data; }
}
export class NetworkError extends Error {
  constructor() { super("Ingen forbindelse til bookingsystemet. Tjek dit netværk og prøv igen."); }
}

let demoMode = false;
let demoApi = null;
export const isDemo = () => demoMode;
// Demo-modulet (opdigtede data) hentes først, når demo vælges - det skal ikke forsinke den rigtige app.
export async function enableDemo() { demoApi = (await import("./demo.js")).api; demoMode = true; }
export function disableDemo() { demoMode = false; }

// Offline-visning: seneste hentede data (kun læsning) gemmes lokalt og vises, hvis der ikke er net - med en tydelig advarsel.
const CACHE_PREFIX = "pedel-c:";
const CACHE_MAX = 12;
let offlineAt = null;
/** Tidspunkt (ms) for de viste data, hvis appen lige nu viser gemte data uden net - ellers null. */
export const offlineSince = () => offlineAt;
function cacheKeys() { const k = []; for (let i = 0; i < localStorage.length; i++) { const n = localStorage.key(i); if (n && n.startsWith(CACHE_PREFIX)) k.push(n); } return k; }
function saveCache(path, data) {
  try {
    const entry = JSON.stringify({ at: Date.now(), data });
    if (entry.length > 1_500_000) return; // for stort - gem ikke
    const keys = cacheKeys().map((k) => { try { return [k, JSON.parse(localStorage.getItem(k)).at]; } catch { return [k, 0]; } }).sort((a, b) => a[1] - b[1]);
    while (keys.length >= CACHE_MAX) localStorage.removeItem(keys.shift()[0]);
    localStorage.setItem(CACHE_PREFIX + path, entry);
  } catch { /* ingen plads/ikke tilladt - ignorer */ }
}
function readCache(path) { try { return JSON.parse(localStorage.getItem(CACHE_PREFIX + path) || "null"); } catch { return null; } }
export function clearCache() { try { cacheKeys().forEach((k) => localStorage.removeItem(k)); } catch { /* ignorer */ } offlineAt = null; }

async function http(method, path, body) {
  let res;
  try {
    // Dårligt net i hallen: læsning opgives efter 12 s i stedet for at hænge for evigt. Skrivning afbrydes ALDRIG
    // med timeout (en booking kunne ellers være gemt på serveren, uden at pedellen ved det, og blive oprettet to gange).
    const ctl = new AbortController();
    const timer = method === "GET" ? setTimeout(() => ctl.abort(), 12000) : null;
    res = await fetch("/api" + path, {
      signal: ctl.signal,
      method,
      credentials: "same-origin",
      cache: "no-store",
      headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (timer) clearTimeout(timer);
  } catch {
    if (method === "GET" && path !== "/auth/me") {
      const hit = readCache(path);
      if (hit) { offlineAt = hit.at; return hit.data; }
    }
    throw new NetworkError();
  }
  offlineAt = null;
  let data = null;
  const text = await res.text();
  if (text) { try { data = JSON.parse(text); } catch { data = null; } }
  if (!res.ok) {
    if (!data && res.status >= 500) data = { error: "Serverfejl i bookingsystemet. Prøv igen om lidt." };
    throw new ApiError(res.status, data);
  }
  if (method === "GET" && path !== "/auth/me" && data) saveCache(path, data);
  return data;
}

const real = {
  me: () => http("GET", "/auth/me").then((d) => d.user),
  login: (email, password) => http("POST", "/auth/login", { email, password }).then((d) => d.user),
  logout: () => http("POST", "/auth/logout"),
  facilities: () => http("GET", "/facilities"),
  organizations: () => http("GET", "/organizations"),
  bookings: (from, to) => http("GET", `/bookings?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`),
  booking: (id) => http("GET", `/bookings/${encodeURIComponent(id)}`),
  dayNotes: (from, to) => http("GET", `/day-notes?from=${from}&to=${to}`),
  checkConflict: (p) => http("POST", "/bookings/check-conflict", p),
  create: (p) => http("POST", "/bookings", p),
  update: (id, p) => http("PATCH", `/bookings/${encodeURIComponent(id)}`, p),
  cancel: (id, reason) => http("DELETE", `/bookings/${encodeURIComponent(id)}`, { reason: reason || undefined }),
};

// Samme metodenavne; peger på demo-lageret (kun i hukommelsen) eller det rigtige system.
export const api = new Proxy({}, {
  get: (_t, name) => (...args) => (demoMode && demoApi ? demoApi : real)[name](...args),
});
