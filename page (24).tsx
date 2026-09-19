import Link from "next/link";
import { db, schema } from "@/db";
import { PageHeader } from "@/components/PageHeader";
import { formatDaDate, formatDaTime } from "@/lib/ai/messages";
import { localISODate, nowLocalDateTimeString } from "@/lib/date";

export const dynamic = "force-dynamic";

function StatCard({ label, value, hint }: { label: string; value: number | string; hint?: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5">
      <div className="text-sm text-slate-500">{label}</div>
      <div className="text-3xl font-semibold text-slate-900 mt-1">{value}</div>
      {hint && <div className="text-xs text-slate-400 mt-1">{hint}</div>}
    </div>
  );
}

function ActionRow({ href, label, count, tone }: { href: string; label: string; count: number; tone: string }) {
  if (count === 0) return null;
  return (
    <Link
      href={href}
      className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3 hover:border-slate-300 transition-colors"
    >
      <span className="text-sm font-medium text-slate-700">{label}</span>
      <span className={`inline-flex items-center justify-center min-w-[1.75rem] h-7 rounded-full px-2 text-sm font-semibold ${tone}`}>
        {count}
      </span>
    </Link>
  );
}

export default async function DashboardPage() {
  const todayStr = localISODate();
  const [bookings, facilities, requests, lines, payments] = await Promise.all([
    db.select().from(schema.bookings),
    db.select().from(schema.facilities),
    db.select().from(schema.bookingRequests),
    db.select().from(schema.bookingRequestLines),
    db.select().from(schema.payments),
  ]);

  const todaysBookings = bookings
    .filter((b) => b.startsAt.slice(0, 10) === todayStr && b.status !== "aflyst" && b.status !== "afvist")
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));

  const activeFacilities = new Set(todaysBookings.map((b) => b.facilityId)).size;
  const upcoming = bookings.filter((b) => b.startsAt > nowLocalDateTimeString() && b.status !== "aflyst").length;
  const newRequests = requests.filter((r) => r.status === "ny").length;
  const conflicts = lines.filter((l) => l.status === "konflikt").length;
  const pendingRequests = lines.filter((l) => l.status === "ledig").length;
  const missingPayments = payments.filter((p) => p.status === "afventer").length;

  const facilityName = (id: string) => facilities.find((f) => f.id === id)?.name ?? "Ukendt facilitet";

  return (
    <div className="animate-fade-in">
      <PageHeader title="Dashboard" subtitle={`I dag, ${formatDaDate(new Date().toISOString())}`} />
      <div className="p-4 md:p-8 space-y-8 max-w-6xl">
        <section>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
            <StatCard label="Bookinger i dag" value={todaysBookings.length} />
            <StatCard label="Aktive faciliteter" value={activeFacilities} hint={`ud af ${facilities.filter((f) => !f.archived).length}`} />
            <StatCard label="Kommende bookinger" value={upcoming} />
            <StatCard label="Nye bookingmails" value={newRequests} />
          </div>
        </section>

        <section>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 mb-3">Kræver handling</h2>
          <div className="space-y-2">
            <ActionRow href="/indbakke" label="Nye mails i indbakken" count={newRequests} tone="bg-blue-100 text-blue-800" />
            <ActionRow href="/indbakke" label="Bookingkonflikter der skal løses" count={conflicts} tone="bg-red-100 text-red-700" />
            <ActionRow href="/indbakke" label="Forespørgsler klar til godkendelse" count={pendingRequests} tone="bg-emerald-100 text-emerald-800" />
            <ActionRow href="/kalender" label="Manglende betalinger" count={missingPayments} tone="bg-amber-100 text-amber-800" />
            {newRequests + conflicts + pendingRequests + missingPayments === 0 && (
              <div className="rounded-xl border border-dashed border-slate-200 px-4 py-6 text-center text-sm text-slate-400">
                Ingen ventende opgaver lige nu.
              </div>
            )}
          </div>
        </section>

        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">I dag</h2>
            <Link href="/kalender" className="text-sm text-blue-600 hover:underline">
              Se hele kalenderen &rarr;
            </Link>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white divide-y divide-slate-100">
            {todaysBookings.length === 0 && (
              <div className="px-4 py-6 text-center text-sm text-slate-400">Ingen bookinger i dag.</div>
            )}
            {todaysBookings.map((b) => (
              <div key={b.id} className="flex items-center justify-between px-4 py-3">
                <div>
                  <div className="font-medium text-slate-800">{b.title}</div>
                  <div className="text-sm text-slate-500">{facilityName(b.facilityId)}</div>
                </div>
                <div className="text-sm font-medium text-slate-600">
                  {formatDaTime(b.startsAt)} - {formatDaTime(b.endsAt)}
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
