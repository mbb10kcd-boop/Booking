import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { db } from "@/db";
import { users } from "@/db/schema";
import { getSessionUser } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) return NextResponse.json({ error: "Ikke logget ind" }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Ugyldig forespørgsel" }, { status: 400 });
  }
  const { currentPassword, newPassword } = (body ?? {}) as {
    currentPassword?: unknown;
    newPassword?: unknown;
  };
  if (typeof currentPassword !== "string" || typeof newPassword !== "string") {
    return NextResponse.json({ error: "Udfyld begge felter" }, { status: 400 });
  }
  if (newPassword.length < 8) {
    return NextResponse.json({ error: "Det nye kodeord skal være mindst 8 tegn" }, { status: 400 });
  }

  const rows = await db.select().from(users).where(eq(users.id, sessionUser.id)).limit(1);
  const user = rows[0];
  if (!user) return NextResponse.json({ error: "Ikke logget ind" }, { status: 401 });

  const currentMatches = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!currentMatches) {
    return NextResponse.json({ error: "Nuværende kodeord er forkert" }, { status: 400 });
  }

  const newHash = bcrypt.hashSync(newPassword, 10);
  await db.update(users).set({ passwordHash: newHash }).where(eq(users.id, user.id));
  return NextResponse.json({ ok: true });
}
