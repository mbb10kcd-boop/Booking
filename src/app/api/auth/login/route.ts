import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { db } from "@/db";
import { users } from "@/db/schema";
import { createSessionToken, SESSION_COOKIE_NAME, SESSION_MAX_AGE_SECONDS } from "@/lib/session";

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Ugyldig forespørgsel" }, { status: 400 });
  }
  const { email, password } = (body ?? {}) as { email?: unknown; password?: unknown };
  if (typeof email !== "string" || typeof password !== "string" || !email || !password) {
    return NextResponse.json({ error: "Email og kodeord skal udfyldes" }, { status: 400 });
  }

  const normalizedEmail = email.trim().toLowerCase();
  const rows = await db.select().from(users).where(eq(users.email, normalizedEmail)).limit(1);
  const user = rows[0];

  // Bevidst samme fejlbesked uanset om det er emailen eller kodeordet der er
  // forkert (og uanset om kontoen er deaktiveret) - afslører ikke om en
  // given email findes i systemet.
  const genericError = NextResponse.json({ error: "Forkert email eller kodeord" }, { status: 401 });
  if (!user || user.active === false) return genericError;

  const passwordMatches = await bcrypt.compare(password, user.passwordHash);
  if (!passwordMatches) return genericError;

  const token = await createSessionToken(user.id);
  const res = NextResponse.json({
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
  });
  res.cookies.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
  return res;
}
