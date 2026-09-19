import { db, schema } from "@/db";
import { PageHeader } from "@/components/PageHeader";
import { CalendarClient } from "@/components/CalendarClient";

export const dynamic = "force-dynamic";

export default async function KalenderPage() {
  const [facilities, organizations] = await Promise.all([
    db.select().from(schema.facilities).orderBy(schema.facilities.sortOrder),
    db.select().from(schema.organizations).orderBy(schema.organizations.name),
  ]);

  return (
    <div>
      <PageHeader title="Kalender" subtitle="Overblik over alle bookinger på tværs af faciliteter" />
      <CalendarClient initialFacilities={facilities} initialOrganizations={organizations} />
    </div>
  );
}
