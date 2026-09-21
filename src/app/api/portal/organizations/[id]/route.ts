import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/db";
import { eq } from "drizzle-orm";

/**
 * Offentlige, begrænsede oplysninger om ÉN forening til foreningsportalen -
 * kun kontaktperson/mail (bruges til at vise dem låst i sidste trin), aldrig
 * CVR/adresse/noter mv. Returnerer 404 hvis foreningen ikke er godkendt, så
 * en forening der afventer godkendelse (eller er afvist) ikke kan bruges.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [org] = await db.select().from(schema.organizations).where(eq(schema.organizations.id, id));
  if (!org || org.status !== "godkendt") {
    return NextResponse.json({ error: "Ikke fundet" }, { status: 404 });
  }
  return NextResponse.json({
    id: org.id,
    name: org.name,
    contactName: org.contactName,
    contactEmail: org.contactEmail,
  });
}
