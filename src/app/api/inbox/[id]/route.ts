import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/db";
import { eq } from "drizzle-orm";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [request] = await db.select().from(schema.bookingRequests).where(eq(schema.bookingRequests.id, id));
  if (!request) return NextResponse.json({ error: "Ikke fundet" }, { status: 404 });
  const lines = await db.select().from(schema.bookingRequestLines).where(eq(schema.bookingRequestLines.requestId, id));
  return NextResponse.json({ ...request, lines });
}
