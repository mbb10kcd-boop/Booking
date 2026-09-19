import { db, schema } from "@/db";
import { desc } from "drizzle-orm";
import { PageHeader } from "@/components/PageHeader";
import { InboxClient } from "@/components/InboxClient";

export const dynamic = "force-dynamic";

export default async function IndbakkePage() {
  const requests = await db.select().from(schema.bookingRequests).orderBy(desc(schema.bookingRequests.createdAt));
  const allLines = await db.select().from(schema.bookingRequestLines);
  const withLines = requests.map((r) => ({ ...r, lines: allLines.filter((l) => l.requestId === r.id) }));

  return (
    <div>
      <PageHeader title="Bookingindbakke" subtitle="Alle indkomne bookingmails, fortolket automatisk" />
      <InboxClient initialRequests={withLines} />
    </div>
  );
}
