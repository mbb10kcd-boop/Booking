import { db, schema } from "@/db";
import { inArray } from "drizzle-orm";
import { PageHeader } from "@/components/PageHeader";
import { RescheduleRequestsClient } from "@/components/RescheduleRequestsClient";

export const dynamic = "force-dynamic";

export default async function AnmodningerPage() {
  const requests = await db.select().from(schema.rescheduleRequests).orderBy(schema.rescheduleRequests.createdAt);

  const orgIds = Array.from(new Set(requests.map((r) => r.organizationId)));
  const facilityIds = Array.from(new Set(requests.flatMap((r) => r.facilityIds)));
  const bookingIds = Array.from(new Set(requests.flatMap((r) => r.conflictingBookingIds)));

  const orgs = orgIds.length ? await db.select().from(schema.organizations).where(inArray(schema.organizations.id, orgIds)) : [];
  const facilities = facilityIds.length
    ? await db.select().from(schema.facilities).where(inArray(schema.facilities.id, facilityIds))
    : [];
  const conflictingBookings = bookingIds.length
    ? await db.select().from(schema.bookings).where(inArray(schema.bookings.id, bookingIds))
    : [];

  const orgById = new Map(orgs.map((o) => [o.id, o]));
  const facilityById = new Map(facilities.map((f) => [f.id, f]));
  const bookingById = new Map(conflictingBookings.map((b) => [b.id, b]));

  const items = requests.map((r) => ({
    id: r.id,
    status: r.status,
    organizationName: orgById.get(r.organizationId)?.name ?? "Ukendt forening",
    facilityNames: r.facilityIds.map((fid) => facilityById.get(fid)?.name ?? "Ukendt facilitet"),
    startsAt: r.startsAt,
    endsAt: r.endsAt,
    notes: r.notes,
    extraEmail: r.extraEmail,
    createdAt: r.createdAt,
    conflictingBookings: r.conflictingBookingIds.map((bid) => {
      const b = bookingById.get(bid);
      return { id: bid, title: b?.title ?? "Ukendt booking (allerede fjernet)", status: b?.status ?? "ukendt" };
    }),
  }));

  return (
    <div>
      <PageHeader
        title="Anmodninger"
        subtitle="Foreninger der har bedt om en tid, der allerede er optaget af en anden forening"
      />
      <RescheduleRequestsClient initialItems={items} />
    </div>
  );
}
