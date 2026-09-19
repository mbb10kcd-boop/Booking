import { db, schema } from "@/db";
import { PageHeader } from "@/components/PageHeader";
import { FacilitiesClient } from "@/components/FacilitiesClient";

export const dynamic = "force-dynamic";

export default async function FaciliteterPage() {
  const facilities = await db.select().from(schema.facilities).orderBy(schema.facilities.sortOrder);
  return (
    <div>
      <PageHeader title="Faciliteter" subtitle="Opret og administrér haller, sale, baner og underressourcer" />
      <FacilitiesClient initialFacilities={facilities} />
    </div>
  );
}
