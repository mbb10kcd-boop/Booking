import { NextRequest, NextResponse } from "next/server";
import { isMailEnabled, sendMail } from "@/lib/mailer";

/** Login-beskyttet diagnostik: er mailafsendelse aktiv? (Viser aldrig nøglen.) */
export async function GET() {
  return NextResponse.json({
    enabled: isMailEnabled(),
    message: isMailEnabled()
      ? "Mailafsendelse via Resend er aktiv."
      : "RESEND_API_KEY er ikke sat - beskeder gemmes kun i notifikationsloggen.",
  });
}

/** Login-beskyttet: send en prøvemail. Body: { "to": "adresse@eksempel.dk" } */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const to = typeof body.to === "string" ? body.to.trim() : "";
  if (!to) return NextResponse.json({ error: "to er påkrævet" }, { status: 400 });
  if (!isMailEnabled()) {
    return NextResponse.json({ enabled: false, error: "RESEND_API_KEY er ikke sat" }, { status: 503 });
  }
  const r = await sendMail({
    to,
    subject: "Prøvemail fra Grenaa Idrætscenters bookingsystem",
    text: "Hej\n\nDette er en prøvemail fra bookingsystemet. Hvis du kan læse den, virker mailafsendelsen.\n\nVenlig hilsen\nGrenaa Idrætscenter",
  });
  return NextResponse.json({ enabled: true, ...r }, { status: r.ok ? 200 : 502 });
}
