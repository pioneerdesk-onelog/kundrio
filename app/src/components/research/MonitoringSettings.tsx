"use client";

import { useActionState } from "react";
import { btnCls } from "@/components/ui";
import { setMonitoring, type ResearchState } from "@/app/(admin)/sa/[slug]/erwaehnungen/actions";

/** Schalter für das wöchentliche Presse-Monitoring (Recht: Einstellungen). */
export function MonitoringSettings({ slug, enabled }: { slug: string; enabled: boolean }) {
  const [state, action, pending] = useActionState<ResearchState, FormData>(setMonitoring.bind(null, slug), {});
  return (
    <form action={action} className="space-y-3">
      <label className="flex items-start gap-3">
        <input type="checkbox" name="enabled" defaultChecked={enabled} className="mt-1 h-4 w-4" />
        <span>
          <span className="font-medium">Wöchentliches Monitoring</span>
          <span className="block text-sm text-ink-400 dark:text-ink-200">
            Montags werden bis zu 25 aktive Unternehmen (mit Zuständigen oder offenem Deal) neu recherchiert. Relevante Treffer lösen das Ereignis „Erwähnung gefunden“ aus;
            bei Insolvenz, Rechtsstreit, Personalie oder Finanzierung bekommt die zuständige Person eine Prüfaufgabe. Suchbegriffe (Firmennamen) gehen an GDELT und an die
            Suchdienste der eigenen Suchmaschine.
          </span>
        </span>
      </label>
      <button className={btnCls} disabled={pending}>
        Speichern
      </button>
      {state.ok && (
        <p role="status" className="text-sm text-emerald-700 dark:text-emerald-300">
          {state.ok}
        </p>
      )}
      {state.error && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-300">
          {state.error}
        </p>
      )}
    </form>
  );
}
