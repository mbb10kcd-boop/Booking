import { NextRequest, NextResponse } from "next/server";
import { and, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { getSessionUser } from "@/lib/auth";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ user: null }, { status: 401 });
  return NextResponse.json({
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
  });
}

/** Lader den indloggede bruger selv rette sit eget navn og/eller email. */
export async function PATCH(req: NextRequest) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) return NextResponse.json({ error: "Ikke logget ind" }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Ugyldig forespørgsel" }, { status: 400 });
  }
  const { name, email } = (body ?? {}) as { name?: unknown; email?: unknown };
  const updates: { name?: string; email?: string } = {};
  if (typeof name === "string" && name.trim()) updates.name = name.trim();
  if (typeof email === "string" && email.trim()) {
    const normalized = email.trim().toLowerCase();
    const existing = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.email, normalized), ne(users.id, sessionUser.id)))
      .limit(1);
    if (existing.length > 0) {
      return NextResponse.json({ error: "Der findes allerede en bruger med denne email" }, { status: 400 });
    }
    updates.email = normalized;
  }
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "Intet at opdatere" }, { status: 400 });
  }

  await db.update(users).set(updates).where(eq(users.id, sessionUser.id));
  return NextResponse.json({ ok: true });
}
