import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/db";
import { eq } from "drizzle-orm";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { text } = await req.json();
  if (!text) {
    return NextResponse.json({ error: "text er påkrævet" }, { status: 400 });
  }
  await db.update(schema.dayNotes).set({ text }).where(eq(schema.dayNotes.id, id));
  const [updated] = await db.select().from(schema.dayNotes).where(eq(schema.dayNotes.id, id));
  return NextResponse.json(updated);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await db.delete(schema.dayNotes).where(eq(schema.dayNotes.id, id));
  return NextResponse.json({ ok: true });
}
