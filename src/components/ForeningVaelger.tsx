"use client";

import { useRouter } from "next/navigation";

/** Dropdown til den offentlige aflysningsliste: vælg din forening og se kun dens aflysninger. */
export default function ForeningVaelger({ names, value }: { names: string[]; value: string }) {
  const router = useRouter();
  return (
    <label className="mb-4 block text-sm">
      <span className="mr-2 font-medium">Vælg forening:</span>
      <select
        value={value}
        className="rounded border border-slate-300 bg-white px-2 py-1.5 text-sm"
        onChange={(e) => {
          const next = new URLSearchParams(window.location.search);
          if (e.target.value) next.set("forening", e.target.value);
          else next.delete("forening");
          const q = next.toString();
          router.push(q ? `?${q}` : "?");
        }}
      >
        <option value="">Alle foreninger</option>
        {names.map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </select>
    </label>
  );
}
