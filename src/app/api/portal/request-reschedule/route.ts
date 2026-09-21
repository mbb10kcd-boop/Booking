import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/db";
import { eq, inArray } from "drizzle-orm";
import { newId } from "@/lib/ids";
import { findConflicts } from "@/lib/conflicts";
import { logAudit } from "@/lib/audit";

/**
 * Foreningsportalens "anmod om aflysning/flytning"-trin: bruges i stedet for
 * /api/portal/book-forening, når det ønskede tidsrum allerede er optaget af
 * en anden forening. I stedet for at blokere foreningen helt, oprettes en
 * anmodning som personalet kan godkende eller afvise under /anmodninger (se
 * PATCH i src/app/api/reschedule-requests/[id]/route.ts).
 */
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { organizationId, facilityIds, startsAt, endsAt, extraEmail, notes } = body as {
    organizationId?: string;
    facilityIds?: string[];
    startsAt?: string;
    endsAt?: string;
    extraEmail?: string;
    notes?: string;
  };

  if (!organizationId || !facilityIds || facilityIds.length === 0 || !startsAt || !endsAt) {
    return NextResponse.json({ error: "Udfyld venligst forening, facilitet(er), dato og tidspunkt" }, { status: 400 });
  }

  const [org] = await db.select().from(schema.organizations).where(eq(schema.organizations.id, organizationId));
  if (!org) return NextResponse.json({ error: "Forening ikke fundet" }, { status: 404 });
  if (org.status !== "godkendt") {
    return NextResponse.json({ error: "Jeres forening afventer stadig godkendelse og kan endnu ikke booke" }, { status: 403 });
  }

  const facilities = await db.select().from(schema.facilities).where(inArray(schema.facilities.id, facilityIds));
  if (facilities.length !== facilityIds.length) {
    return NextResponse.json({ error: "En eller flere faciliteter blev ikke fundet" }, { status: 404 });
  }
  const hiddenSelected = facilities.filter((f) => f.hiddenFromOrgPortal);
  if (hiddenSelected.length > 0) {
    return NextResponse.json({ error: "En eller flere valgte faciliteter kan ikke bookes af foreninger" }, { status: 400 });
  }

  const conflictingIds = new Set<string>();
  for (const facilityId of facilityIds) {
    const conflicts = await findConflicts(facilityId, startsAt, endsAt);
    conflicts.forEach((c) => conflictingIds.add(c.id));
  }
  if (conflictingIds.size === 0) {
    // Tiden er faktisk ledig lige nu (fx nåede en anden anmodning at blive
    // afvist/aflyst, mens foreningen sad og udfyldte formularen) - der er
    // ingen grund til en anmodning, når den bare kan bookes direkte.
    return NextResponse.json(
      { error: "Tiden er nu ledig - gå tilbage og book den direkte i stedet for at sende en anmodning." },
      { status: 409 }
    );
  }

  const id = newId("resched");
  await db.insert(schema.rescheduleRequests).values({
    id,
    organizationId,
    facilityIds,
    startsAt,
    endsAt,
    extraEmail: extraEmail || null,
    notes: notes || null,
    conflictingBookingIds: Array.from(conflictingIds),
    status: "afventer",
  });
  await logAudit("reschedule_request", id, "oprettet", `Anmodning fra ${org.name} via foreningsportalen`, org.name);

  return NextResponse.json({ id, status: "afventer" }, { status: 201 });
}
