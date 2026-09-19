import { NextResponse } from "next/server";
import { db, schema } from "@/db";
import { desc } from "drizzle-orm";

/** Viser genererede beskeder (simuleret afsendelse - der er endnu ikke koblet en rigtig mailudbyder på) */
export async function GET() {
  const log = await db.select().from(schema.notificationLog).orderBy(desc(schema.notificationLog.sentAt));
  return NextResponse.json(log);
}
