import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/db";
import { newId } from "@/lib/ids";
import { logAudit } from "@/lib/audit";
import { desc, asc } from "drizzle-orm";

export async function GET() {
  // "Interne" organisationer (fx GIC, se schema.ts) sorteres altid øverst,
  // resten alfabetisk - så personalet ikke skal lede efter GIC i et
  // dropdown med snart 50 foreninger, når de opretter en booking.
  const orgs = await db
    .select()
    .from(schema.organizations)
    .orderBy(desc(schema.organizations.internal), asc(schema.organizations.name));
  return NextResponse.json(orgs);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const id = newId("org");
  const org = {
    id,
    name: body.name,
    cvr: body.cvr ?? null,
    address: body.address ?? null,
    contactName: body.contactName ?? null,
    contactEmail: body.contactEmail ?? null,
    contactPhone: body.contactPhone ?? null,
    notes: body.notes ?? null,
    billingInfo: body.billingInfo ?? null,
  };
  await db.insert(schema.organizations).values(org);
  await logAudit("organization", id, "oprettet", `Forening "${org.name}" oprettet`);
  return NextResponse.json(org, { status: 201 });
}
