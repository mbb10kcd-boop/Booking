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

async function http(method, path, body) {
  let res;
  try {
    res = await fetch("/api" + path, {
      method,
      credentials: "same-origin",
      cache: "no-store",
      headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new NetworkError();
  }
  let data = null;
  const text = await res.text();
  if (text) { try { data = JSON.parse(text); } catch { data = null; } }
  if (!res.ok) {
    if (!data && res.status >= 500) data = { error: "Serverfejl i bookingsystemet. Prøv igen om lidt." };
    throw new ApiError(res.status, data);
  }
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
