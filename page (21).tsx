import { db, schema } from "@/db";
import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/PageHeader";
import { InboxDetailClient } from "@/components/InboxDetailClient";

export const dynamic = "force-dynamic";

export default async function InboxDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [request] = await db.select().from(schema.bookingRequests).where(eq(schema.bookingRequests.id, id));
  if (!request) notFound();

  const [lines, facilities, allBookings] = await Promise.all([
    db.select().from(schema.bookingRequestLines).where(eq(schema.bookingRequestLines.requestId, id)),
    db.select().from(schema.facilities),
    db.select().from(schema.bookings),
  ]);

  const conflictBookingIds = lines.map((l) => l.conflictBookingId).filter(Boolean) as string[];
  const conflictBookings = allBookings.filter((b) => conflictBookingIds.includes(b.id));

  return (
    <div>
      <PageHeader
        title={request.parsedOrganizationName ?? request.parsedContactName ?? "Bookingforespørgsel"}
        subtitle={request.type === "saeson" ? "Sæsonbooking fra mail" : "Enkeltforespørgsel fra mail"}
      />
      <InboxDetailClient request={request} initialLines={lines} facilities={facilities} conflictBookings={conflictBookings} />
    </div>
  );
}
