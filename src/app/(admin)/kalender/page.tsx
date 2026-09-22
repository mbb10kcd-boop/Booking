import { db, schema } from "@/db";
import { desc, asc } from "drizzle-orm";
import { PageHeader } from "@/components/PageHeader";
import { CalendarClient } from "@/components/CalendarClient";

export const dynamic = "force-dynamic";

export default async function KalenderPage() {
  const [facilities, organizations] = await Promise.all([
    db.select().from(schema.facilities).orderBy(schema.facilities.sortOrder),
    // "Interne" organisationer (fx GIC) øverst, resten alfabetisk - se
    // /api/organizations for samme sortering.
    db
      .select()
      .from(schema.organizations)
      .orderBy(desc(schema.organizations.internal), asc(schema.organizations.name)),
  ]);

  return (
    <div>
      <PageHeader title="Kalender" subtitle="Overblik over alle bookinger på tværs af faciliteter" />
      <CalendarClient initialFacilities={facilities} initialOrganizations={organizations} />
    </div>
  );
}
