// Signeret session-cookie uden ekstern afhængighed (bcryptjs bruges kun til
// selve kodeordet, ikke til sessionen). Bruger Web Crypto (crypto.subtle),
// som findes både i Next.js' middleware (Edge-runtime) og i almindelige
// route handlers (Node) - så det samme modul kan bruges begge steder uden
// at trække Node's "crypto"-modul ind, som ikke findes i Edge-runtime.

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export const SESSION_COOKIE_NAME = "gic_session";
const DEFAULT_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 dage

export interface SessionPayload {
  uid: string;
  exp: number; // unix-sekunder
}

function getSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (secret && secret.length > 0) return secret;
  // Ingen SESSION_SECRET sat (fx lokal udvikling). I produktion på Render
  // SKAL denne sættes som en rigtig, tilfældig værdi - ellers kan alle, der
  // kender denne standardværdi (den ligger i kildekoden), forfalske en
  // login-session. Se README/procesplan for hvordan man sætter den.
  return "usikker-lokal-udviklings-noegle-ikke-til-produktion";
}

function toBase64Url(bytes: Uint8Array): string {
  let str = "";
  for (let i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const withPadding = padded + "=".repeat((4 - (padded.length % 4)) % 4);
  const str = atob(withPadding);
  const bytes = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) bytes[i] = str.charCodeAt(i);
  return bytes;
}

async function getHmacKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(getSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

/** Opretter en signeret session-token for en given bruger-id. */
export async function createSessionToken(
  uid: string,
  maxAgeSeconds: number = DEFAULT_MAX_AGE_SECONDS
): Promise<string> {
  const payload: SessionPayload = {
    uid,
    exp: Math.floor(Date.now() / 1000) + maxAgeSeconds,
  };
  const payloadPart = toBase64Url(encoder.encode(JSON.stringify(payload)));
  const key = await getHmacKey();
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payloadPart));
  const signaturePart = toBase64Url(new Uint8Array(signature));
  return `${payloadPart}.${signaturePart}`;
}

/**
 * Verificerer en session-token og returnerer dens indhold, eller null hvis
 * token mangler, er forfalsket, ugyldigt formateret eller udløbet.
 */
export async function verifySessionToken(
  token: string | undefined | null
): Promise<SessionPayload | null> {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payloadPart, signaturePart] = parts;
  try {
    const key = await getHmacKey();
    const validSignature = await crypto.subtle.verify(
      "HMAC",
      key,
      fromBase64Url(signaturePart),
      encoder.encode(payloadPart)
    );
    if (!validSignature) return null;
    const payload = JSON.parse(decoder.decode(fromBase64Url(payloadPart))) as SessionPayload;
    if (typeof payload.uid !== "string" || typeof payload.exp !== "number") return null;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

export const SESSION_MAX_AGE_SECONDS = DEFAULT_MAX_AGE_SECONDS;
