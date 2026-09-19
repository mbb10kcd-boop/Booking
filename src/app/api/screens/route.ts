import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/db";
import { newId } from "@/lib/ids";

export async function GET() {
  const screens = await db.select().from(schema.infoScreens);
  return NextResponse.json(screens);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const id = newId("screen");
  const screen = {
    id,
    name: body.name,
    location: body.location ?? null,
    facilityIds: body.facilityIds ?? [],
    layout: body.layout ?? "standard",
  };
  await db.insert(schema.infoScreens).values(screen);
  return NextResponse.json(screen, { status: 201 });
}
