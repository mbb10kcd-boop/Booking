import { COMPANY } from "@/lib/company";

export const metadata = { title: "Handelsbetingelser - Grenaa Idrætscenter" };

/** Handelsbetingelser for onlinebooking og -betaling (Nexi kræver et link hertil). */
export default function VilkaarPage() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-50 to-white flex justify-center px-4 py-8 md:py-14">
      <div className="w-full max-w-2xl rounded-3xl border border-slate-200 bg-white p-6 md:p-8 shadow-sm space-y-5 text-sm text-slate-700 leading-relaxed">
        <div>
          <div className="text-blue-600 font-semibold text-xs uppercase tracking-wide">{COMPANY.name}</div>
          <h1 className="text-2xl font-bold text-slate-900 mt-1">Handelsbetingelser</h1>
        </div>

        <section>
          <h2 className="font-semibold text-slate-900">Hvem sælger</h2>
          <p>
            {COMPANY.name}
            {COMPANY.address && <>, {COMPANY.address}</>}
            {COMPANY.cvr && <>, CVR {COMPANY.cvr}</>}
            {COMPANY.phone && <>, tlf. {COMPANY.phone}</>}
            {COMPANY.email && <>, {COMPANY.email}</>}.
          </p>
        </section>

        <section>
          <h2 className="font-semibold text-slate-900">Hvad du køber</h2>
          <p>
            Du booker et bestemt tidsrum i en af vores faciliteter (fx en bane). Prisen og tidsrummet vises, før du
            betaler. Alle priser er i danske kroner.
          </p>
        </section>

        <section>
          <h2 className="font-semibold text-slate-900">Betaling</h2>
          <p>
            Du betaler med Dankort eller MobilePay via Nexi (tidligere Nets). Beløbet trækkes, når du gennemfører
            betalingen. Dine kortoplysninger indtastes hos Nexi og gemmes ikke af os. Din booking er først bekræftet,
            når betalingen er gennemført.
          </p>
        </section>

        <section>
          <h2 className="font-semibold text-slate-900">Adgang og dørkode</h2>
          <p>
            Når betalingen er gennemført, får du en dørkode på skærmen og i en mail. Koden virker kun i det tidsrum, du
            har booket (og et kort stykke tid før start).
          </p>
        </section>

        <section>
          <h2 className="font-semibold text-slate-900">Aflysning og ændring</h2>
          <p>
            Ønsker du at aflyse eller flytte din tid, så kontakt os hurtigst muligt. Vi finder sammen en løsning, hvis
            det er muligt. Hvis vi selv må aflyse (fx ved driftsforstyrrelser), får du pengene tilbage.
          </p>
        </section>

        <section>
          <h2 className="font-semibold text-slate-900">Fortrydelsesret</h2>
          <p>
            Booking af et bestemt tidsrum til en fritidsaktivitet er omfattet af undtagelsen fra den almindelige
            14 dages fortrydelsesret i forbrugeraftaleloven, fordi aftalen gælder et bestemt tidspunkt. Det betyder, at
            du ikke automatisk kan fortryde købet efter betaling.
          </p>
        </section>

        <section>
          <h2 className="font-semibold text-slate-900">Personoplysninger</h2>
          <p>
            Vi bruger dit navn, din mail og dit telefonnummer til at gennemføre og bekræfte din booking og sende din
            dørkode. Oplysningerne bruges ikke til andet.
          </p>
        </section>
      </div>
    </div>
  );
}
