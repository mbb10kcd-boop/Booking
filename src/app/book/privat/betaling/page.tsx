"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { DOOR_EARLY_MINUTES } from "@/lib/doorConfig";
import { formatDaDate, formatDaTime, capitalizeDaDate } from "@/lib/ai/messages";

/**
 * Hvor kunden lander efter Nexis betalingsside. Siden spørger serveren, om
 * betalingen er registreret (Nexis webhook kan komme lidt efter kunden), og
 * viser derefter kvittering med dørkode - eller en forklaring, hvis kunden
 * afbrød, eller betalingen udløb.
 */

type Status = {
  status: "afventer" | "betalt" | "konflikt" | "annulleret";
  accessCode?: string | null;
  accessCodeError?: boolean;
  bookings?: { startsAt: string; endsAt: string; facilityName: string }[];
};

const POLL_MS = 2000;
const MAX_POLLS = 30;

function Inner() {
  const params = useSearchParams();
  const paymentId = params.get("payment");
  const cancelled = params.get("afbrudt") === "1";
  const [status, setStatus] = useState<Status | null>(null);
  const [timedOut, setTimedOut] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!paymentId) return;
    let stopped = false;

    async function run() {
      try {
        if (cancelled) {
          // Kunden trykkede "annuller" hos Nexi: frigiv tiden (efter et sidste tjek hos Nexi).
          const res = await fetch(`/api/portal/pay/${paymentId}/cancel`, { method: "POST" });
          if (!res.ok) throw new Error("cancel");
        }
        for (let i = 0; i < MAX_POLLS && !stopped; i++) {
          // eslint-disable-next-line no-await-in-loop
          const res = await fetch(`/api/portal/pay/${paymentId}/status`, { cache: "no-store" });
          if (!res.ok) throw new Error("status");
          // eslint-disable-next-line no-await-in-loop
          const data: Status = await res.json();
          if (stopped) return;
          setStatus(data);
          if (data.status !== "afventer") return;
          if (cancelled) return; // afbrudt og stadig ikke betalt: bliv ikke ved med at vente
          // eslint-disable-next-line no-await-in-loop
          await new Promise((r) => setTimeout(r, POLL_MS));
        }
        if (!stopped) setTimedOut(true);
      } catch {
        if (!stopped) setError("Vi kunne ikke hente status for din betaling. Opdater siden om lidt.");
      }
    }
    run();
    return () => {
      stopped = true;
    };
  }, [paymentId, cancelled]);

  const first = status?.bookings?.[0];

  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-50 to-white flex justify-center px-4 py-8 md:py-14">
      <div className="w-full max-w-md">
        <div className="text-center mb-6">
          <div className="text-blue-600 font-semibold text-sm uppercase tracking-wide">Grenaa Idrætscenter</div>
          <h1 className="text-2xl font-bold text-slate-900 mt-1">Betaling</h1>
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm space-y-4 text-center">
          {!paymentId && <p className="text-sm text-slate-600">Vi kunne ikke finde din betaling.</p>}

          {paymentId && error && <p className="text-sm text-red-600">{error}</p>}

          {paymentId && !error && (!status || status.status === "afventer") && !timedOut && !cancelled && (
            <>
              <div className="text-sm text-slate-600">Vi bekræfter din betaling hos Nexi...</div>
              <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-blue-200 border-t-blue-600" />
            </>
          )}

          {paymentId && !error && status?.status === "afventer" && cancelled && (
            <p className="text-sm text-slate-600">
              Din betaling blev afbrudt, og vi har endnu ikke modtaget en betaling. Kommer du alligevel til at betale,
              får du en mail med din bekræftelse.
            </p>
          )}

          {paymentId && !error && status?.status === "afventer" && timedOut && !cancelled && (
            <p className="text-sm text-slate-600">
              Vi venter stadig på bekræftelse fra Nexi. Du behøver ikke betale igen - så snart betalingen er registreret,
              får du en mail med din bekræftelse og dørkode. Du kan også opdatere siden om lidt.
            </p>
          )}

          {status?.status === "annulleret" && (
            <>
              <p className="text-sm text-slate-600">
                {cancelled
                  ? "Din betaling blev afbrudt, og der er ikke trukket nogen penge. Tiden er frigivet."
                  : "Betalingen blev ikke gennemført i tide, og tiden er frigivet. Der er ikke trukket nogen penge."}
              </p>
              <a href="/book/privat" className="inline-block rounded-xl bg-blue-600 text-white px-5 py-3 font-medium">
                Book en ny tid
              </a>
            </>
          )}

          {status?.status === "konflikt" && (
            <p className="text-sm text-red-700">
              Din betaling er gennemført, men din tid var desværre nået at blive givet til en anden, mens du betalte. Vi
              kontakter dig, og du får pengene tilbage. Du er velkommen til at kontakte Grenaa Idrætscenter.
            </p>
          )}

          {status?.status === "betalt" && first && (
            <>
              <div className="text-4xl">&#10003;</div>
              <h2 className="font-semibold text-slate-900 text-lg">Betaling gennemført - booking bekræftet!</h2>
              <div className="text-sm text-slate-600">
                {status.bookings!.map((b, i) => (
                  <div key={i}>{b.facilityName}</div>
                ))}
                <div className="mt-1">
                  {capitalizeDaDate(formatDaDate(first.startsAt))}
                  <br />
                  {formatDaTime(first.startsAt)} - {formatDaTime(first.endsAt)}
                </div>
              </div>
              {status.accessCode && (
                <div className="rounded-xl bg-blue-50 border border-blue-200 py-4">
                  <div className="text-xs text-blue-500 uppercase tracking-wide">Din dørkode</div>
                  <div className="text-3xl font-mono font-bold text-blue-800">{status.accessCode}</div>
                  <div className="text-xs text-blue-600 mt-2">
                    Koden virker fra {DOOR_EARLY_MINUTES} minutter før din tid starter.
                  </div>
                </div>
              )}
              {status.accessCodeError && (
                <div className="rounded-xl bg-red-50 border border-red-200 py-3 px-4 text-sm text-red-700">
                  Vi kunne desværre ikke oprette din dørkode automatisk. Din tid er reserveret og betalt - kontakt
                  Grenaa Idrætscenter, så sender vi koden hurtigst muligt.
                </div>
              )}
              <p className="text-xs text-slate-400">Du får også en bekræftelse på mail.</p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function BetalingRetur() {
  return (
    <Suspense fallback={null}>
      <Inner />
    </Suspense>
  );
}
