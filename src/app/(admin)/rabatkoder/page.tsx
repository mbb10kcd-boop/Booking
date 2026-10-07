import { PageHeader } from "@/components/PageHeader";
import { DiscountCodesClient } from "@/components/DiscountCodesClient";

export const dynamic = "force-dynamic";

export default function RabatkoderPage() {
  return (
    <div>
      <PageHeader title="Rabatkoder" subtitle="Koder gæster kan bruge ved privat booking - fx sommerhuspakker eller præmier" />
      <DiscountCodesClient />
    </div>
  );
}
