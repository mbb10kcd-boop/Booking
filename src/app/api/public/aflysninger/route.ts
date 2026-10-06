import { NextResponse } from "next/server";
import { loadCancelList } from "@/lib/cancelList";

export const dynamic = "force-dynamic";

/** Offentlig JSON-udgave af aflysningslisten (til evt. andre sider/skærme). */
export async function GET() {
  const items = await loadCancelList();
  return NextResponse.json(
    { updatedAt: new Date().toISOString(), items },
    { headers: { "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=60" } }
  );
}
