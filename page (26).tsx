import { db, schema } from "@/db";
import { PageHeader } from "@/components/PageHeader";
import { OrganizationsClient } from "@/components/OrganizationsClient";

export const dynamic = "force-dynamic";

export default async function ForeningerPage() {
  const organizations = await db.select().from(schema.organizations).orderBy(schema.organizations.name);
  return (
    <div>
      <PageHeader title="Foreninger" subtitle="Database over foreninger og eksterne kunder" />
      <OrganizationsClient initialOrganizations={organizations} />
    </div>
  );
}
