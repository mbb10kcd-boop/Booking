import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { db } from "@/db";
import { users } from "@/db/schema";
import { getSessionUser } from "@/lib/auth";

const STAFF_ROLES = ["admin", "medarbejder", "pedel"] as const;
type StaffRole = (typeof STAFF_ROLES)[number];

function isStaffRole(value: unknown): value is StaffRole {
  return typeof value === "string" && (STAFF_ROLES as readonly string[]).includes(value);
}

async function requireAdmin(): Promise<{ user?: Awaited<ReturnType<typeof getSessionUser>>; error?: NextResponse }> {
  const user = await getSessionUser();
  if (!user) return { error: NextResponse.json({ error: "Ikke logget ind" }, { status: 401 }) };
  if (user.role !== "admin") {
    return { error: NextResponse.json({ error: "Kræver administrator-adgang" }, { status: 403 }) };
  }
  return { user };
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { user: adminUser, error } = await requireAdmin();
  if (error) return error;
  const { id } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Ugyldig forespørgsel" }, { status: 400 });
  }
  const { name, email, role, active, password } = (body ?? {}) as {
    name?: unknown;
    email?: unknown;
    role?: unknown;
    active?: unknown;
    password?: unknown;
  };

  const updates: Partial<{
    name: string;
    email: string;
    role: StaffRole;
    active: boolean;
    passwordHash: string;
  }> = {};

  if (typeof name === "string" && name.trim()) updates.name = name.trim();
  if (typeof email === "string" && email.trim()) {
    const normalized = email.trim().toLowerCase();
    const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, normalized)).limit(1);
    if (existing.length > 0 && existing[0].id !== id) {
      return NextResponse.json({ error: "Der findes allerede en bruger med denne email" }, { status: 400 });
    }
    updates.email = normalized;
  }
  if (role !== undefined) {
    if (!isStaffRole(role)) return NextResponse.json({ error: "Ugyldig rolle" }, { status: 400 });
    updates.role = role;
  }
  if (typeof active === "boolean") {
    // En admin kan ikke deaktivere sin egen eneste adgang ved et uheld,
    // hvis vedkommende er den eneste aktive admin - undgår at systemet
    // låses helt, hvis der kun er én administrator.
    if (id === adminUser!.id && active === false) {
      const otherActiveAdmins = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.role, "admin"));
      const remaining = otherActiveAdmins.filter((u) => u.id !== id);
      if (remaining.length === 0) {
        return NextResponse.json(
          { error: "Du kan ikke deaktivere din egen konto, når du er den eneste administrator" },
          { status: 400 }
        );
      }
    }
    updates.active = active;
  }
  if (typeof password === "string" && password.length > 0) {
    if (password.length < 8) {
      return NextResponse.json({ error: "Kodeord skal være mindst 8 tegn" }, { status: 400 });
    }
    updates.passwordHash = bcrypt.hashSync(password, 10);
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "Intet at opdatere" }, { status: 400 });
  }

  await db.update(users).set(updates).where(eq(users.id, id));
  return NextResponse.json({ ok: true });
}
