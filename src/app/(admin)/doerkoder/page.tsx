import { db, schema } from "@/db";
import { asc, eq, ne, and, gte } from "drizzle-orm";
import { PageHeader } from "@/components/PageHeader";

export const dynamic = "force-dynamic";

const DOOR_LABELS: Record<string, string> = {
  traeningshallen: "Træningshallen",
  multisalen: "Multisalen",
};

export default async function DoerkoderPage() {
  const pool = await db.select().from(schema.doorCodePool).orderBy(asc(schema.doorCodePool.code));
  const facilities = await db.select().from(schema.facilities);

  const now = new Date().toISOString();
  const activeCodes = await db
    .select()
    .from(schema.accessCodes)
    .innerJoin(schema.bookings, eq(schema.accessCodes.bookingId, schema.bookings.id))
    .where(
      and(
        gte(schema.accessCodes.validTo, now),
        ne(schema.bookings.status, "aflyst"),
        ne(schema.bookings.status, "afvist")
      )
    );

  const doorIds = Array.from(new Set(pool.map((p) => p.doorId)));

  function facilitiesForDoor(doorId: string) {
    return facilities
      .filter((f) => f.weAccessDoorId === doorId || facilities.find((p) => p.id === f.parentId)?.weAccessDoorId === doorId)
      .map((f) => f.name);
  }

  function usageForCode(code: string, doorId: string) {
    return activeCodes
      .filter((row) => row.access_codes.doorId === doorId && row.access_codes.code === code)
      .map((row) => ({
        booking: row.bookings.title,
        from: row.access_codes.validFrom,
        to: row.access_codes.validTo,
      }));
  }

  return (
    <div>
      <PageHeader
        title="Dørkoder"
        subtitle="Faste koder der skal tastes direkte ind i den fysiske kodelås - se forklaring nedenfor"
      />
      <div className="p-4 md:p-8 max-w-4xl space-y-8">
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          Der findes p.t. ingen brugbar API til automatisk at sende nye koder til dørene (hverken via WeAccess eller
          andre undersøgte fabrikater). Løsningen er derfor et fast sæt på 20 koder pr. kodedør, som skal tastes ind
          i selve låsen/kodetastaturet ÉN gang. Herefter styrer systemet selv, hvem der får hvilken kode hvornår - en
          kode genbruges automatisk, når den ikke er i brug af en anden aktiv booking i et overlappende tidsrum.
        </div>

        {doorIds.map((doorId) => {
          const codes = pool.filter((p) => p.doorId === doorId);
          const relevantFacilities = facilitiesForDoor(doorId);
          return (
            <div key={doorId} className="rounded-2xl border border-slate-200 bg-white p-5">
              <div className="mb-1 text-lg font-semibold text-slate-900">{DOOR_LABELS[doorId] ?? doorId}</div>
              <div className="mb-4 text-sm text-slate-500">
                Dækker: {relevantFacilities.length > 0 ? relevantFacilities.join(", ") : "-"}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {codes.map((entry) => {
                  const usage = usageForCode(entry.code, doorId);
                  const busy = usage.length > 0;
                  return (
                    <div
                      key={entry.id}
                      className={`rounded-xl border px-3 py-2 text-center ${
                        busy ? "border-blue-200 bg-blue-50" : "border-slate-200 bg-slate-50"
                      }`}
                      title={busy ? usage.map((u) => `${u.booking} (${u.from} - ${u.to})`).join(", ") : "Ledig"}
                    >
                      <div className="text-lg font-mono font-semibold text-slate-900">{entry.code}</div>
                      <div className={`text-[11px] ${busy ? "text-blue-700" : "text-slate-400"}`}>
                        {busy ? "I brug nu" : "Ledig"}
                      </div>
                    </div>
                  );
                })}
              </div>
              {codes.length === 0 && (
                <div className="text-sm text-slate-400">Ingen koder i puljen endnu.</div>
              )}
            </div>
          );
        })}

        {doorIds.length === 0 && (
          <div className="rounded-2xl border border-dashed border-slate-200 p-10 text-center text-slate-400">
            Ingen kodedøre fundet.
          </div>
        )}
      </div>
    </div>
  );
}
