import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/db";
import { eq, and, ne } from "drizzle-orm";
import { newId } from "@/lib/ids";
import { logAudit } from "@/lib/audit";

/**
 * Offentlig liste til foreningsportalen: kun GODKENDTE foreninger, og kun de
 * felter der er nødvendige for at vælge sin forening i en dropdown (ikke
 * CVR/adresse/noter mv., som er interne oplysninger). Interne
 * "organisationer" (fx GIC, personalets egen bruger til kommerciel
 * udlejning - se schema.ts) er IKKE rigtige foreninger og skal derfor aldrig
 * kunne vælges her.
 */
export async function GET() {
  const orgs = await db
    .select({ id: schema.organizations.id, name: schema.organizations.name })
    .from(schema.organizations)
    .where(and(eq(schema.organizations.status, "godkendt"), ne(schema.organizations.internal, true)))
    .orderBy(schema.organizations.name);
  return NextResponse.json(orgs);
}

/**
 * "Opret forening"-knappen i foreningsportalen: opretter foreningen med
 * status "afventer_godkendelse" - den kan altså IKKE bruges til at booke,
 * før personalet har godkendt den i administrationen (se /foreninger og
 * PATCH /api/organizations/[id]).
 */
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { name, contactName, contactEmail, contactPhone, cvr, address } = body;
  if (!name || !contactName || !contactEmail) {
    return NextResponse.json({ error: "Udfyld venligst foreningens navn, kontaktperson og e-mail" }, { status: 400 });
  }

  const id = newId("org");
  await db.insert(schema.organizations).values({
    id,
    name,
    cvr: cvr ?? null,
    address: address ?? null,
    contactName,
    contactEmail,
    contactPhone: contactPhone ?? null,
    status: "afventer_godkendelse",
  });
  await logAudit("organization", id, "oprettet", `Forening "${name}" oprettet via foreningsportalen - afventer godkendelse`, contactName);

  return NextResponse.json({ id, name, status: "afventer_godkendelse" }, { status: 201 });
}
