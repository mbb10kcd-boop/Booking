import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { db } from "@/db";
import { users } from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import { newId } from "@/lib/ids";

const STAFF_ROLES = ["admin", "medarbejder", "pedel"] as const;
type StaffRole = (typeof STAFF_ROLES)[number];

function isStaffRole(value: unknown): value is StaffRole {
  return typeof value === "string" && (STAFF_ROLES as readonly string[]).includes(value);
}

/** Kun admin-brugere må se/administrere personalekonti. */
async function requireAdmin(): Promise<{ user?: Awaited<ReturnType<typeof getSessionUser>>; error?: NextResponse }> {
  const user = await getSessionUser();
  if (!user) return { error: NextResponse.json({ error: "Ikke logget ind" }, { status: 401 }) };
  if (user.role !== "admin") {
    return { error: NextResponse.json({ error: "Kræver administrator-adgang" }, { status: 403 }) };
  }
  return { user };
}

export async function GET() {
  const { error } = await requireAdmin();
  if (error) return error;

  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      active: users.active,
      createdAt: users.createdAt,
    })
    .from(users)
    .orderBy(users.name);
  return NextResponse.json({ users: rows });
}

export async function POST(req: NextRequest) {
  const { error } = await requireAdmin();
  if (error) return error;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Ugyldig forespørgsel" }, { status: 400 });
  }
  const { name, email, password, role } = (body ?? {}) as {
    name?: unknown;
    email?: unknown;
    password?: unknown;
    role?: unknown;
  };
  if (typeof name !== "string" || !name.trim()) {
    return NextResponse.json({ error: "Navn skal udfyldes" }, { status: 400 });
  }
  if (typeof email !== "string" || !email.trim()) {
    return NextResponse.json({ error: "Email skal udfyldes" }, { status: 400 });
  }
  if (typeof password !== "string" || password.length < 8) {
    return NextResponse.json({ error: "Kodeord skal være mindst 8 tegn" }, { status: 400 });
  }
  if (!isStaffRole(role)) {
    return NextResponse.json({ error: "Ugyldig rolle" }, { status: 400 });
  }

  const normalizedEmail = email.trim().toLowerCase();
  const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, normalizedEmail)).limit(1);
  if (existing.length > 0) {
    return NextResponse.json({ error: "Der findes allerede en bruger med denne email" }, { status: 400 });
  }

  const newUser = {
    id: newId("user"),
    name: name.trim(),
    email: normalizedEmail,
    passwordHash: bcrypt.hashSync(password, 10),
    role,
    active: true,
  };
  await db.insert(users).values(newUser);
  return NextResponse.json({
    user: { id: newUser.id, name: newUser.name, email: newUser.email, role: newUser.role, active: true },
  });
}
