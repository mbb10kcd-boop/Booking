import { db, schema } from "@/db";
import { desc } from "drizzle-orm";
import { PageHeader } from "@/components/PageHeader";

export const dynamic = "force-dynamic";

const TYPE_LABELS: Record<string, string> = {
  bekraeftelse: "Bekræftelse",
  aflysning: "Aflysning",
  aendring: "Ændring",
  paamindelse: "Påmindelse",
  betalingskvittering: "Betalingskvittering",
  adgangskode: "Adgangskode",
  konflikt: "Konflikt",
  afvisning: "Afvisning",
};

export default async function NotifikationerPage() {
  const log = await db.select().from(schema.notificationLog).orderBy(desc(schema.notificationLog.sentAt));

  return (
    <div>
      <PageHeader
        title="Genererede beskeder"
        subtitle="Simuleret udsendelse - der er endnu ikke koblet en rigtig mailudbyder på (se ARKITEKTUR.md)"
      />
      <div className="p-4 md:p-8 max-w-3xl space-y-3">
        {log.map((n) => (
          <div key={n.id} className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200">
                {TYPE_LABELS[n.type] ?? n.type}
              </span>
              <span className="text-xs text-slate-400">Til: {n.recipient ?? "ukendt"}</span>
            </div>
            {n.subject && <div className="font-medium text-slate-800 text-sm mb-1">{n.subject}</div>}
            <pre className="whitespace-pre-wrap text-sm text-slate-600 font-sans">{n.body}</pre>
          </div>
        ))}
        {log.length === 0 && (
          <div className="rounded-2xl border border-dashed border-slate-200 p-10 text-center text-slate-400">
            Ingen beskeder genereret endnu.
          </div>
        )}
      </div>
    </div>
  );
}
