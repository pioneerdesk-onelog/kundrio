"use client";

import { StateForm, Submit, type FormState } from "./StateForm";

export function FourEyesForm({ action, enabled, canEdit }: { action: (p: FormState, fd: FormData) => Promise<FormState>; enabled: boolean; canEdit: boolean }) {
  return (
    <StateForm action={action}>
      <label className="flex items-start gap-2 text-[15px]">
        <input type="checkbox" name="fourEyes" defaultChecked={enabled} disabled={!canEdit} className="mt-1" />
        <span>
          <span className="font-medium">Vier-Augen-Prinzip für Freigaben</span>
          <span className="block text-sm text-ink-400">
            Wer eine Aktion mit Außenwirkung beantragt (E-Mail, Prozess mit Versand, MCP-Anfrage), darf sie nicht selbst freigeben – eine zweite Person mit Freigaberecht muss zustimmen. Sinnvoll ab zwei Personen mit Freigaberecht, z. B. in regulierten Branchen.
          </span>
        </span>
      </label>
      {canEdit && <Submit variant="ghost">Speichern</Submit>}
    </StateForm>
  );
}
