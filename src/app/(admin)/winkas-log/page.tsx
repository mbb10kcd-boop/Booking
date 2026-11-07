import { PageHeader } from "@/components/PageHeader";
import { WinkasLogClient } from "@/components/WinkasLogClient";

export const dynamic = "force-dynamic";

export default function WinkasLogPage() {
  return (
    <div>
      <PageHeader
        title="Winkas-log"
        subtitle="Bookinger, der er oprettet, flyttet eller aflyst her siden sidste log - til indtastning i Winkas"
      />
      <WinkasLogClient />
    </div>
  );
}
