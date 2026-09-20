export const BOOKING_STATUS_LABELS: Record<string, string> = {
  forespoergsel: "Forespørgsel",
  afventer_godkendelse: "Afventer godkendelse",
  reserveret: "Reserveret",
  bekraeftet: "Bekræftet",
  betalt: "Betalt",
  aflyst: "Aflyst",
  flyttet: "Flyttet",
  afvist: "Afvist",
  midlertidig: "Midlertidig",
};

// Farver er valgt så de også kan skelnes uden farvesyn (forskellig mætning/mønster
// bruges desuden i UI'et via ikoner/tekst, ikke kun farve).
export const BOOKING_STATUS_CLASSES: Record<string, string> = {
  forespoergsel: "bg-slate-100 text-slate-700 border-slate-300",
  afventer_godkendelse: "bg-amber-100 text-amber-800 border-amber-300",
  reserveret: "bg-blue-100 text-blue-800 border-blue-300",
  bekraeftet: "bg-emerald-100 text-emerald-800 border-emerald-300",
  betalt: "bg-green-100 text-green-800 border-green-300",
  aflyst: "bg-red-100 text-red-700 border-red-300 line-through",
  flyttet: "bg-purple-100 text-purple-800 border-purple-300",
  afvist: "bg-red-100 text-red-700 border-red-300",
  midlertidig: "bg-amber-50 text-amber-700 border-amber-200 border-dashed",
};

// Sæsonbookinger (gentagne ugentlige forekomster, grupperet via
// `seasonGroupId`) skal kunne skelnes fra enkeltbookinger på tværs af alle
// kalendervisninger, UANSET status - fx skal en aflyst enkeltdag i en sæson
// stadig være tydeligt markeret som "del af en sæson" ind til den er aflyst.
// Derfor er dette en selvstændig, ekstra markering (ring uden om kortet + et
// lille "↻"-ikon og en badge), ikke endnu en status-farve.
export const SEASON_ACCENT_CLASS = "ring-2 ring-inset ring-indigo-400";
export const SEASON_BADGE_CLASSES = "bg-indigo-100 text-indigo-700 border-indigo-300";
export const SEASON_BADGE_LABEL = "↻ Sæson";

export const REQUEST_LINE_STATUS_LABELS: Record<string, string> = {
  ledig: "Ledig",
  konflikt: "Konflikt",
  godkendt: "Godkendt",
  afvist: "Afvist",
  flyttet: "Flyttet",
};

export const REQUEST_LINE_STATUS_CLASSES: Record<string, string> = {
  ledig: "bg-emerald-100 text-emerald-800 border-emerald-300",
  konflikt: "bg-red-100 text-red-700 border-red-300",
  godkendt: "bg-blue-100 text-blue-800 border-blue-300",
  afvist: "bg-slate-100 text-slate-600 border-slate-300",
  flyttet: "bg-purple-100 text-purple-800 border-purple-300",
};

const WEEKDAY_NAMES = ["Søndag", "Mandag", "Tirsdag", "Onsdag", "Torsdag", "Fredag", "Lørdag"];
export function weekdayName(index: number | null | undefined): string {
  if (index === null || index === undefined) return "";
  return WEEKDAY_NAMES[index] ?? "";
}
