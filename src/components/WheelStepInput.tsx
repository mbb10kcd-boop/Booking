"use client";

import { useEffect, useRef } from "react";
import { stepDateTimeLocalString, stepTimeString } from "@/lib/date";

/**
 * <input type="datetime-local"> eller <input type="time"> hvor museknap-rul
 * altid springer i trin af `stepMinutes` minutter (standard 10), uanset
 * hvilket felt (time/minut/dag) der er markeret i inputtet.
 *
 * Baggrund: vi havde tidligere `onWheel` som en almindelig JSX-prop, med et
 * `e.preventDefault()` inde i handleren for at overtage rul-håndteringen selv
 * (se `stepDateTimeLocalString`/`stepTimeString` nedenfor). Det virkede IKKE
 * konsekvent - centeret rapporterede at det stadig sprang 60 minutter ad
 * gangen ved rul. Årsagen er at React (17+) af præstationshensyn selv
 * tilknytter JSX' `onWheel` som en PASSIV native event listener, og et
 * `preventDefault()` i en passiv listener er en stille no-op - browserens
 * indbyggede opførsel (som for `datetime-local` er at ændre det markerede
 * delfelt med 1 enhed AF DETS EGEN GRANULARITET, dvs. 1 helt tal - ignorerer
 * `step`) vinder alligevel. Løsningen er at binde en RIGTIG, ikke-passiv
 * native listener direkte på DOM-noden via `addEventListener(..., {passive:
 * false})` i en `useEffect`, hvilket denne komponent gør - bekræftet ved
 * manuel test i en rigtig browser.
 */
export function WheelStepInput({
  type,
  value,
  onChange,
  onRoundedBlur,
  step = 600,
  stepMinutes = 10,
  disabled,
  className,
}: {
  type: "datetime-local" | "time";
  value: string;
  onChange: (next: string) => void;
  /** Kaldes med den afrundede værdi ved blur (til fx roundDateTimeLocalString/roundTimeString), hvis feltet ikke er tomt. */
  onRoundedBlur?: (roundedValue: string) => string;
  step?: number;
  stepMinutes?: number;
  disabled?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLInputElement | null>(null);
  // Rul-handleren tilknyttes kun ÉN gang pr. input (se useEffect-deps
  // herunder) - den skal derfor altid kunne se den NYESTE value/onChange,
  // uden at vi genopretter selve listeneren ved hvert tastetryk. Refs løser
  // det: de opdateres ved hvert render, men trigger ikke effekten igen.
  const valueRef = useRef(value);
  valueRef.current = value;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    function handleWheel(e: WheelEvent) {
      if (document.activeElement !== el || !valueRef.current) return;
      e.preventDefault();
      const delta = e.deltaY < 0 ? stepMinutes : -stepMinutes;
      const next =
        type === "datetime-local"
          ? stepDateTimeLocalString(valueRef.current, delta)
          : stepTimeString(valueRef.current, delta);
      onChangeRef.current(next);
    }
    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, [type, stepMinutes]);

  return (
    <input
      ref={ref}
      type={type}
      step={step}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      onBlur={(e) => {
        if (!e.target.value || !onRoundedBlur) return;
        onChange(onRoundedBlur(e.target.value));
      }}
      className={className}
    />
  );
}
