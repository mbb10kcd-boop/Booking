import { NextRequest, NextResponse } from "next/server";
import { approveLine, editLineProposal, rejectLine } from "@/lib/inboxActions";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ lineId: string }> }) {
  const { lineId } = await params;
  const body = await req.json();
  const { action } = body;

  try {
    if (action === "godkend") {
      const result = await approveLine(lineId, false);
      return NextResponse.json({ ok: true, result });
    }
    if (action === "overtag") {
      const result = await approveLine(lineId, true);
      return NextResponse.json({ ok: true, result });
    }
    if (action === "afvis") {
      const result = await rejectLine(lineId);
      return NextResponse.json({ ok: true, result });
    }
    if (action === "rediger") {
      const updated = await editLineProposal(lineId, body.updates ?? {});
      return NextResponse.json({ ok: true, line: updated });
    }
    return NextResponse.json({ error: "Ukendt handling" }, { status: 400 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Ukendt fejl";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
