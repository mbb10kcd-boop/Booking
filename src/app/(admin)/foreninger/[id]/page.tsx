import { db, schema } from "@/db";
import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/PageHeader";
import { BOOKING_STATUS_CLASSES, BOOKING_STATUS_LABELS } from "@/lib/statusLabels";
import { formatDaDate, formatDaTime } from "@/lib/ai/messages";

export const dynamic = "force-dynamic";

export default async function OrganizationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [org] = await db.select().from(schema.organizations).where(eq(schema.organizations.id, id));
  if (!org) notFound();

  const bookings = await db.select().from(schema.bookings).where(eq(schema.bookings.organizationId, id));
  const facilities = await db.select().from(schema.facilities);
  const facilityName = (fid: string) => facilities.find((f) => f.id === fid)?.name ?? "Ukendt";

  const upcoming = bookings.filter((b) => b.status !== "aflyst").sort((a, b) => a.startsAt.localeCompare(b.startsAt));

  return (
    <div>
      <PageHeader title={org.name} subtitle="Forening" />
      <div className="p-4 md:p-8 max-w-3xl space-y-6">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 grid grid-cols-2 gap-4 text-sm">
          <div>
            <div className="text-slate-500">Kontaktperson</div>
            <div className="font-medium text-slate-900">{org.contactName ?? "-"}</div>
          </div>
          <div>
            <div className="text-slate-500">Telefon</div>
            <div className="font-medium text-slate-900">{org.contactPhone ?? "-"}</div>
          </div>
          <div>
            <div className="text-slate-500">E-mail</div>
            <div className="font-medium text-slate-900">{org.contactEmail ?? "-"}</div>
          </div>
          <div>
            <div className="text-slate-500">CVR</div>
            <div className="font-medium text-slate-900">{org.cvr ?? "-"}</div>
          </div>
          <div className="col-span-2">
            <div className="text-slate-500">Adresse</div>
            <div className="font-medium text-slate-900">{org.address ?? "-"}</div>
          </div>
        </div>

        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 mb-3">
            Bookinghistorik ({upcoming.length})
          </h2>
          <div className="rounded-2xl border border-slate-200 bg-white divide-y divide-slate-100">
            {upcoming.map((b) => (
              <div key={b.id} className="flex items-center justify-between px-4 py-3 text-sm">
                <div>
                  <div className="font-medium text-slate-800">{facilityName(b.facilityId)}</div>
                  <div className="text-slate-500">
                    {formatDaDate(b.startsAt)}, {formatDaTime(b.startsAt)}-{formatDaTime(b.endsAt)}
                  </div>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded-full border ${BOOKING_STATUS_CLASSES[b.status]}`}>
                  {BOOKING_STATUS_LABELS[b.status]}
                </span>
              </div>
            ))}
            {upcoming.length === 0 && <div className="px-4 py-6 text-center text-sm text-slate-400">Ingen bookinger endnu.</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
