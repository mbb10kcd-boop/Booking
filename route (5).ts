import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/db";
import { eq } from "drizzle-orm";
import { logAudit } from "@/lib/audit";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [facility] = await db.select().from(schema.facilities).where(eq(schema.facilities.id, id));
  if (!facility) return NextResponse.json({ error: "Ikke fundet" }, { status: 404 });
  return NextResponse.json(facility);
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  await db.update(schema.facilities).set(body).where(eq(schema.facilities.id, id));
  await logAudit("facility", id, "opdateret", JSON.stringify(body));
  const [facility] = await db.select().from(schema.facilities).where(eq(schema.facilities.id, id));
  return NextResponse.json(facility);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await db.update(schema.facilities).set({ archived: true }).where(eq(schema.facilities.id, id));
  await logAudit("facility", id, "arkiveret");
  return NextResponse.json({ ok: true });
}
