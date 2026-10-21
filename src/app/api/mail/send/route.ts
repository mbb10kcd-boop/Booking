import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/db";
import { eq } from "drizzle-orm";
import { newId } from "@/lib/ids";
import { sendNotification } from "@/lib/mailer";

/**
 * Login-beskyttet: sender en (af den ansatte gennemset og evt. rettet) mail
 * og gemmer den i notifikationsloggen. Bruges fx til mailen om de datoer, der
 * blev sprunget over ved en sæsonbooking "først til mølle".
 * Body: { to, subject, text, bookingId? }
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const to = typeof body.to === "string" ? body.to.trim() : "";
  const subject = typeof body.subject === "string" ? body.subject.trim() : "";
  const text = typeof body.text === "string" ? body.text : "";
  if (!to || !subject || !text.trim()) {
    return NextResponse.json({ error: "to, subject og text er påkrævet" }, { status: 400 });
  }
  const id = newId("notif");
  await sendNotification({
    id,
    bookingId: typeof body.bookingId === "string" ? body.bookingId : null,
    type: "aendring",
    recipient: to,
    subject,
    body: text,
  });
  const [row] = await db.select().from(schema.notificationLog).where(eq(schema.notificationLog.id, id));
  const status = row?.deliveryStatus ?? "ukendt";
  if (status === "fejlet") {
    return NextResponse.json({ ok: false, status, error: row?.deliveryError ?? "ukendt fejl" }, { status: 502 });
  }
  // "simuleret" = mailudbyder er ikke sat op; beskeden er kun gemt i notifikationsloggen.
  return NextResponse.json({ ok: true, status });
}
