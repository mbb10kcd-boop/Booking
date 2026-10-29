import { NextResponse } from "next/server";
import { isNexiEnabled } from "@/lib/nexi";

/** Fortæller portalen om betalingen er rigtig (Nexi) eller simuleret - så teksten på betalingsskærmen passer. */
export async function GET() {
  return NextResponse.json({ nexi: isNexiEnabled() });
}
