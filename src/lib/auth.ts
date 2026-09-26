import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { SESSION_COOKIE_NAME, verifySessionToken } from "./session";

export type UserRole = "admin" | "medarbejder" | "pedel" | "forening" | "kunde";

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  active: boolean | null;
}

/**
 * Henter den aktuelt indloggede bruger (server-side) ud fra session-cookien,
 * eller null hvis ingen er logget ind, sessionen er ugyldig/udløbet, eller
 * brugeren er blevet deaktiveret eller slettet siden login. Bruges i
 * server components (fx (admin)/layout.tsx) og i API route handlers, der
 * skal vide HVEM der er logget ind (til forskel fra middleware.ts, som kun
 * tjekker at der overhovedet findes en gyldig session-cookie).
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE_NAME)?.value;
  const payload = await verifySessionToken(token);
  if (!payload) return null;

  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      active: users.active,
    })
    .from(users)
    .where(eq(users.id, payload.uid))
    .limit(1);

  const user = rows[0];
  if (!user || user.active === false) return null;
  return user;
}
