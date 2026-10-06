import { db, schema } from "@/db";
import { eq } from "drizzle-orm";
import { logAudit } from "@/lib/audit";

/**
 * Mailafsendelse via Resend (https://resend.com) - en HTTP-API, så det virker
 * på Render uanset plan (Renders gratis tjenester blokerer SMTP-porte).
 *
 * Aktiveres ved at sætte RESEND_API_KEY i Render (kun selve nøglen, én linje).
 * Uden nøgle virker alt som før: beskeden skrives kun til notifikationsloggen
 * (/notifikationer) og der sendes ingen rigtig mail.
 *
 * Valgfrie env-variabler:
 *   MAIL_FROM      Afsender, fx "Grenaa Idrætscenter <booking@grenaaic.dk>"
 *   MAIL_REPLY_TO  Hvor svar skal hen, fx "info@grenaaic.dk"
 *
 * Domænet i MAIL_FROM skal være verificeret i Resend (SPF/DKIM i DNS).
 */

function firstToken(v: string | undefined): string {
  return (v ?? "").trim().split(/\s+/)[0] ?? "";
}

const FROM = (process.env.MAIL_FROM ?? "").trim() || "Grenaa Idrætscenter <booking@grenaaic.dk>";
const REPLY_TO = firstToken(process.env.MAIL_REPLY_TO) || "info@grenaaic.dk";
const TIMEOUT_MS = 10_000;

export function isMailEnabled(): boolean {
  return !!firstToken(process.env.RESEND_API_KEY);
}

const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

type SendResult = { ok: true; id?: string } | { ok: false; error: string };

/** Sender én mail. Kaster aldrig - returnerer resultatet. Fejlteksten indeholder aldrig nøglen. */
export async function sendMail(opts: { to: string; subject: string; text: string }): Promise<SendResult> {
  const apiKey = firstToken(process.env.RESEND_API_KEY);
  if (!apiKey) return { ok: false, error: "RESEND_API_KEY er ikke sat" };
  if (!EMAIL_RE.test(opts.to)) return { ok: false, error: "ugyldig modtager" };

  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: FROM,
          to: [opts.to],
          reply_to: REPLY_TO,
          subject: opts.subject,
          text: opts.text,
        }),
        signal: controller.signal,
      });
      const raw = await res.text();
      if (res.status === 429 && attempt === 0) {
        // Resend tillader få kald i sekundet - vent et øjeblik og prøv én gang til.
        await new Promise((r) => setTimeout(r, 1000));
        continue;
      }
      if (!res.ok) {
        let detail = raw.slice(0, 200);
        try {
          const j = JSON.parse(raw);
          detail = j.message || j.error || detail;
        } catch {
          /* behold rå tekst */
        }
        return { ok: false, error: `HTTP ${res.status}: ${detail}` };
      }
      try {
        return { ok: true, id: JSON.parse(raw).id };
      } catch {
        return { ok: true };
      }
    } catch (err) {
      const aborted = err instanceof Error && err.name === "AbortError";
      return { ok: false, error: aborted ? "timeout" : "netværksfejl" };
    } finally {
      clearTimeout(timer);
    }
  }
  return { ok: false, error: "afvist (for mange kald)" };
}

type NotificationInsert = typeof schema.notificationLog.$inferInsert;

/**
 * Erstatter direkte inserts i notificationLog: gemmer beskeden i loggen (som
 * før) og sender den som rigtig mail, hvis RESEND_API_KEY er sat. Resultatet
 * gemmes i deliveryStatus ("sendt" | "fejlet" | "simuleret") og en fejl
 * skrives også til auditloggen. Kaster aldrig - en mailfejl må ikke vælte
 * en booking.
 */
export async function sendNotification(values: NotificationInsert): Promise<void> {
  const enabled = isMailEnabled();
  await db.insert(schema.notificationLog).values({
    ...values,
    deliveryStatus: enabled ? "afsender" : "simuleret",
  });
  if (!enabled) return;

  let status: "sendt" | "fejlet" = "fejlet";
  let error: string | null = null;
  try {
    const recipient = values.recipient ?? "";
    const r = await sendMail({
      to: recipient,
      subject: values.subject ?? "Besked fra Grenaa Idrætscenter",
      text: values.body ?? "",
    });
    if (r.ok) status = "sendt";
    else error = r.error;
  } catch {
    error = "ukendt fejl";
  }

  try {
    await db
      .update(schema.notificationLog)
      .set({ deliveryStatus: status, deliveryError: error })
      .where(eq(schema.notificationLog.id, values.id));
    if (status === "fejlet") {
      await logAudit(
        "booking",
        values.bookingId ?? "ukendt",
        "mail_fejlet",
        `Mail "${values.subject ?? ""}" til ${values.recipient ?? "ukendt"} kunne ikke sendes: ${error}`
      );
    }
  } catch {
    /* logning er best effort */
  }
}
