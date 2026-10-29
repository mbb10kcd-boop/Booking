/**
 * Klient til Nexi Checkout (tidligere Nets Easy) - betaling med Dankort og
 * MobilePay via Nexis HOSTEDE betalingsside: kunden sendes til Nexi, vælger
 * selv betalingsmetode dér, og kommer tilbage til os bagefter. Kortdata
 * rører aldrig vores server.
 *
 * Bruges KUN fra serversiden: den hemmelige nøgle må aldrig ud i browseren
 * eller i git.
 *
 * Konfiguration (miljøvariabler på Render):
 *   NEXI_SECRET_KEY      (HEMMELIG - uden den er Nexi slået fra, og
 *                         /api/portal/pay/<id> falder tilbage til den
 *                         simulerede betaling)
 *   NEXI_ENV             "test" (standard) eller "live" - vælger API-adresse.
 *                         Brug test-nøglen med "test" og live-nøglen med "live".
 *   NEXI_WEBHOOK_SECRET  (valgfri, 8-64 bogstaver/tal) - sendes af Nexi som
 *                         Authorization-header på webhook-kaldet, så vi kan se
 *                         at kaldet er ægte. Anbefales kraftigt.
 *   PUBLIC_BASE_URL      (valgfri) fx https://booking.grenaaic.dk - bruges til
 *                         returadresser og webhook. Standard er den adresse
 *                         kaldet kom ind på.
 *
 * Endpoints (se developer.nexigroup.com/nexi-checkout):
 *   POST /v1/payments            opret betaling -> paymentId + hostedPaymentPageUrl
 *   GET  /v1/payments/<id>       hent betaling (summary.chargedAmount osv.)
 * Beløb er i mindste enhed (øre). Authorization-headeren er selve nøglen
 * (uden "Bearer").
 */

const TEST_BASE = "https://test.api.dibspayment.eu";
const LIVE_BASE = "https://api.dibspayment.eu";
const TIMEOUT_MS = 15_000;

function firstToken(v: string | undefined): string {
  return (v ?? "").trim().split(/\s+/)[0] ?? "";
}

export function isNexiEnabled(): boolean {
  return firstToken(process.env.NEXI_SECRET_KEY).length > 0;
}

function apiBase(): string {
  // Kun til test mod en falsk Nexi-server (NEXI_API_BASE_URL); sættes aldrig i drift.
  const override = firstToken(process.env.NEXI_API_BASE_URL).replace(/\/+$/, "");
  if (override) return override;
  return (process.env.NEXI_ENV ?? "test").trim().toLowerCase() === "live" ? LIVE_BASE : TEST_BASE;
}

export function nexiWebhookSecret(): string {
  return firstToken(process.env.NEXI_WEBHOOK_SECRET);
}

export class NexiError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "NexiError";
    this.status = status;
  }
}

async function nexiFetch(path: string, init: { method: "GET" | "POST"; body?: unknown; idempotencyKey?: string }) {
  const key = firstToken(process.env.NEXI_SECRET_KEY);
  if (!key) throw new NexiError("NEXI_SECRET_KEY mangler");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${apiBase()}${path}`, {
      method: init.method,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: key,
        ...(init.idempotencyKey ? { "Idempotency-Key": init.idempotencyKey.slice(0, 63) } : {}),
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
      signal: ctrl.signal,
      cache: "no-store",
    });
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      /* ikke JSON */
    }
    if (!res.ok) {
      throw new NexiError(`Nexi svarede ${res.status}: ${text.slice(0, 300)}`, res.status);
    }
    return json as Record<string, unknown>;
  } catch (err) {
    if (err instanceof NexiError) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    throw new NexiError(`Kunne ikke kontakte Nexi: ${msg}`);
  } finally {
    clearTimeout(timer);
  }
}

/** Kroner -> øre (heltal). */
export function toMinorUnits(amountDkk: number): number {
  return Math.round(amountDkk * 100);
}

export interface NexiOrderItem {
  reference: string;
  name: string;
  /** Linjens samlede pris i kroner (ekskl. moms) - antal er altid 1, så Nexis regnestykke altid går op. */
  amountDkk: number;
}

/**
 * Opretter en betaling og returnerer adressen kunden skal sendes til.
 * Idrætsfaciliteter udlejes momsfrit her (vat = 0 i payments-tabellen), så
 * brutto = netto og taxRate = 0.
 */
export async function createNexiPayment(opts: {
  /** Vores egen betalings-id (payments.id) - bruges som ordrereference. */
  reference: string;
  items: NexiOrderItem[];
  /** Samlet beløb i kroner EFTER rabat. */
  totalDkk: number;
  returnUrl: string;
  cancelUrl: string;
  termsUrl: string;
  webhookUrl: string;
}): Promise<{ paymentId: string; hostedPaymentPageUrl: string }> {
  const total = toMinorUnits(opts.totalDkk);
  if (total <= 0) throw new NexiError("Beløbet skal være større end 0");

  // Linjerne skal summe til ordrens samlede beløb. Rabat (eller afrunding)
  // fordeles derfor ved at justere sidste linje; ellers afviser Nexi ordren.
  const gross = opts.items.map((it) => toMinorUnits(it.amountDkk));
  const sum = gross.reduce((s2, g) => s2 + g, 0);
  if (gross.length > 0 && sum !== total) gross[gross.length - 1] += total - sum;

  const items = opts.items.map((it, i) => ({
    reference: it.reference.slice(0, 128),
    name: it.name.slice(0, 128),
    quantity: 1,
    unit: "stk",
    unitPrice: gross[i],
    taxRate: 0,
    taxAmount: 0,
    grossTotalAmount: gross[i],
    netTotalAmount: gross[i],
  }));

  const secret = nexiWebhookSecret();
  const body = {
    order: {
      items,
      amount: total,
      currency: "DKK",
      reference: opts.reference,
    },
    checkout: {
      integrationType: "HostedPaymentPage",
      returnUrl: opts.returnUrl,
      cancelUrl: opts.cancelUrl,
      termsUrl: opts.termsUrl,
      // Træk pengene med det samme (ydelsen leveres ved bookingen), i stedet
      // for blot at reservere beløbet på kortet.
      charge: true,
      consumerType: { default: "B2C", supportedTypes: ["B2C"] },
    },
    notifications: {
      webHooks: [
        {
          eventName: "payment.checkout.completed",
          url: opts.webhookUrl,
          ...(secret ? { authorization: secret } : {}),
        },
      ],
    },
  };

  const json = await nexiFetch("/v1/payments", {
    method: "POST",
    body,
    idempotencyKey: `book-${opts.reference}`,
  });
  const paymentId = typeof json?.paymentId === "string" ? json.paymentId : null;
  const url = typeof json?.hostedPaymentPageUrl === "string" ? json.hostedPaymentPageUrl : null;
  if (!paymentId || !url) throw new NexiError("Uventet svar fra Nexi (mangler paymentId/hostedPaymentPageUrl)");
  return { paymentId, hostedPaymentPageUrl: url };
}

/** Offentlig adresse til returlinks og webhook (PUBLIC_BASE_URL, ellers den adresse kaldet kom ind på). */
export function publicBaseUrl(req: { headers: Headers; nextUrl: { origin: string } }): string {
  const fromEnv = firstToken(process.env.PUBLIC_BASE_URL).replace(/\/+$/, "");
  if (fromEnv) return fromEnv;
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  if (host) return `${proto.split(",")[0]}://${host.split(",")[0]}`;
  return req.nextUrl.origin;
}

export interface NexiPaymentState {
  /** Beløbet er trukket (eller reserveret) i fuld størrelse. */
  paid: boolean;
  /** Beløb i øre (til log/kontrol). */
  chargedAmount: number;
  reservedAmount: number;
  orderAmount: number | null;
  paymentMethod: string | null;
}

/** Slår betalingen op hos Nexi - den eneste kilde vi stoler på for "betalt". */
export async function getNexiPayment(paymentId: string): Promise<NexiPaymentState> {
  const json = await nexiFetch(`/v1/payments/${encodeURIComponent(paymentId)}`, { method: "GET" });
  // Svaret pakkes ofte ind i { payment: {...} } - understøt begge former.
  const p = ((json?.payment as Record<string, unknown> | undefined) ?? json) as Record<string, unknown>;
  const summary = (p?.summary as Record<string, unknown> | undefined) ?? {};
  const orderDetails = (p?.orderDetails as Record<string, unknown> | undefined) ?? {};
  const details = (p?.paymentDetails as Record<string, unknown> | undefined) ?? {};
  const charged = Number(summary.chargedAmount ?? 0) || 0;
  const reserved = Number(summary.reservedAmount ?? 0) || 0;
  const orderAmount = orderDetails.amount != null ? Number(orderDetails.amount) : null;
  // Kunden har betalt når hele ordrebeløbet er trukket (charge: true). En ren
  // reservation tæller også, hvis den dækker hele beløbet (fx hvis nogen
  // senere skifter til reserver-og-træk).
  const covered = Math.max(charged, reserved);
  const paid = orderAmount != null ? covered >= orderAmount && orderAmount > 0 : covered > 0;
  return {
    paid,
    chargedAmount: charged,
    reservedAmount: reserved,
    orderAmount,
    paymentMethod: typeof details.paymentMethod === "string" ? details.paymentMethod : null,
  };
}
