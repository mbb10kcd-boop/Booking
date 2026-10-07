import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/db";
import { eq } from "drizzle-orm";
import { logAudit } from "@/lib/audit";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const set: Partial<typeof schema.discountCodes.$inferInsert> = {};
  if (typeof body.active === "boolean") set.active = body.active;
  if (body.label !== undefined) set.label = body.label?.trim() || null;
  if (body.validFrom !== undefined) set.validFrom = body.validFrom || null;
  if (body.validUntil !== undefined) set.validUntil = body.validUntil || null;
  if (body.maxUses !== undefined) set.maxUses = body.maxUses === "" || body.maxUses === null ? null : Math.floor(Number(body.maxUses));
  if (Object.keys(set).length === 0) return NextResponse.json({ error: "Intet at opdatere" }, { status: 400 });
  await db.update(schema.discountCodes).set(set).where(eq(schema.discountCodes.id, id));
  await logAudit("discount_code", id, "opdateret", JSON.stringify(set));
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await db.delete(schema.discountCodes).where(eq(schema.discountCodes.id, id));
  await logAudit("discount_code", id, "slettet");
  return NextResponse.json({ ok: true });
}
