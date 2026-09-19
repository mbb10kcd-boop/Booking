import { db, schema } from "@/db";
import { PageHeader } from "@/components/PageHeader";
import { ScreensClient } from "@/components/ScreensClient";

export const dynamic = "force-dynamic";

export default async function SkaermePage() {
  const [screens, facilities] = await Promise.all([
    db.select().from(schema.infoScreens),
    db.select().from(schema.facilities).orderBy(schema.facilities.sortOrder),
  ]);
  return (
    <div>
      <PageHeader title="Infoskærme" subtitle="Administrér hvilke skærme der findes, og hvad de viser" />
      <ScreensClient initialScreens={screens} facilities={facilities} />
    </div>
  );
}
