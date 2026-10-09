"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Lädt die Seite in Abständen neu, solange `active` (z. B. ein Import läuft). */
export function AutoRefresh({ active, ms = 4000 }: { active: boolean; ms?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => router.refresh(), ms);
    return () => clearInterval(t);
  }, [active, ms, router]);
  return null;
}
