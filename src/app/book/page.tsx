import Link from "next/link";

/**
 * Landingsside for den offentlige bookingportal (indlejres typisk på
 * hjemmesiden, se AdminNav). Herfra vælger den besøgende om de booker som
 * forening (kræver en godkendt forening, se /book/forening) eller som
 * privatperson (den oprindelige, uændrede portal, se /book/privat).
 */
export default function PublicBookingLanding() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-50 to-white flex justify-center px-4 py-8 md:py-14">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="text-blue-600 font-semibold text-sm uppercase tracking-wide">Grenaa Idrætscenter</div>
          <h1 className="text-2xl font-bold text-slate-900 mt-1">Book en tid</h1>
          <p className="text-sm text-slate-500 mt-2">Hvem booker du på vegne af?</p>
        </div>

        <div className="space-y-4">
          <Link
            href="/book/forening"
            className="block rounded-2xl border border-slate-200 bg-white p-6 shadow-sm hover:border-blue-300 hover:shadow-md transition"
          >
            <div className="text-lg font-semibold text-slate-900">Forening</div>
            <p className="text-sm text-slate-500 mt-1">
              Book på vegne af en forening eller klub - kræver at foreningen er oprettet og godkendt hos os.
            </p>
          </Link>

          <Link
            href="/book/privat"
            className="block rounded-2xl border border-slate-200 bg-white p-6 shadow-sm hover:border-blue-300 hover:shadow-md transition"
          >
            <div className="text-lg font-semibold text-slate-900">Privatperson</div>
            <p className="text-sm text-slate-500 mt-1">Book en tid som privatperson.</p>
          </Link>
        </div>
      </div>
    </div>
  );
}
