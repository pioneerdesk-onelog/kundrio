"use client";

import { Card, btnGhostCls } from "@/components/ui";

// Fehler im Sub-Account freundlich anzeigen (z. B. fehlende Berechtigung oder ungültige Eingabe).
export default function SubAccountError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  // In Produktion verbirgt Next die Fehlermeldung; dann allgemeiner Hinweis
  const msg = error.message && !error.message.includes("Server Components") ? error.message : null;
  return (
    <Card title="Das hat nicht geklappt">
      <p className="text-[15px] text-ink-600 dark:text-ink-200">
        {msg ?? "Die Aktion konnte nicht ausgeführt werden. Möglicherweise fehlt Ihnen die Berechtigung oder eine Eingabe war ungültig."}
      </p>
      <button onClick={reset} className={`${btnGhostCls} mt-4`}>Erneut versuchen</button>
    </Card>
  );
}
