"use client";

import { ACTIONS, ACTION_LABELS, OBJECTS, OBJECT_KEYS, SCOPES, SCOPE_LABELS, SPECIALS, SPECIAL_KEYS, type Permissions } from "@/lib/permissions/catalog";
import { StateForm, Submit, type FormState } from "./StateForm";

const SPECIAL_HELP: Record<string, string> = {
  export: "Getrennt vom Lesen: Wer exportieren darf, kann Daten aus dem System mitnehmen.",
  import: "Massenhaft Daten anlegen oder ändern (CSV, Brevo, HubSpot).",
  approve: "Aktionen mit Außenwirkung freigeben (E-Mails, Prozesse mit Versand, MCP-Anfragen).",
  publish_processes: "Prozesse live schalten. Prozesse mit Außenwirkung brauchen zusätzlich eine Freigabe.",
  send_campaigns: "Freigegebene Kampagnen tatsächlich versenden.",
  manage_keys: "API-, MCP- und Webhook-Zugänge anlegen oder widerrufen.",
  manage_settings: "Name, Branding, Absender, Firmendaten, Vier-Augen-Prinzip.",
  manage_users: "Mitglieder einladen, Rollen und Teams verwalten.",
  view_audit: "Sehen, wer wann was getan hat (inkl. KI-/MCP-Aufrufe).",
};

export function RoleMatrix({
  action,
  name,
  description,
  permissions,
  readOnly,
}: {
  action: (p: FormState, fd: FormData) => Promise<FormState>;
  name: string;
  description: string;
  permissions: Permissions;
  readOnly: boolean;
}) {
  return (
    <StateForm action={action} className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-sm font-medium">Name</span>
          <input name="name" defaultValue={name} required maxLength={60} disabled={readOnly} className="w-full rounded-md border border-ink-200 bg-white px-3 py-2 text-[15px] dark:border-white/15 dark:bg-ink-900" />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium">Beschreibung</span>
          <input name="description" defaultValue={description} maxLength={200} disabled={readOnly} className="w-full rounded-md border border-ink-200 bg-white px-3 py-2 text-[15px] dark:border-white/15 dark:bg-ink-900" />
        </label>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[15px]">
          <caption className="mb-2 text-left text-sm text-ink-400">
            Reichweite: <b>eigene</b> = Datensätze, für die die Person zuständig ist (und unzugewiesene) · <b>Team</b> = auch die der Teamkollegen · <b>alle</b> = alles im Sub-Account. Bereiche ohne zuständige Person kennen nur „keine“ oder „alle“.
          </caption>
          <thead>
            <tr className="border-b border-ink-100 text-left text-sm text-ink-400 dark:border-white/10">
              <th scope="col" className="py-2 pr-3 font-medium">Bereich</th>
              {ACTIONS.map((a) => <th key={a} scope="col" className="py-2 pr-3 font-medium">{ACTION_LABELS[a]}</th>)}
            </tr>
          </thead>
          <tbody>
            {OBJECT_KEYS.map((k) => (
              <tr key={k} className="border-b border-ink-100 last:border-0 dark:border-white/10">
                <th scope="row" className="py-2 pr-3 text-left font-normal">{OBJECTS[k].label}</th>
                {ACTIONS.map((a) => (
                  <td key={a} className="py-1.5 pr-3">
                    <select
                      name={`o.${k}.${a}`}
                      defaultValue={permissions.objects[k][a]}
                      disabled={readOnly}
                      aria-label={`${OBJECTS[k].label} ${ACTION_LABELS[a]}`}
                      className="rounded-md border border-ink-200 bg-white px-2 py-1 text-[15px] dark:border-white/15 dark:bg-ink-900"
                    >
                      {SCOPES.filter((s) => OBJECTS[k].owned || s === "none" || s === "all").map((s) => (
                        <option key={s} value={s}>{SCOPE_LABELS[s]}</option>
                      ))}
                    </select>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <fieldset>
        <legend className="mb-2 font-semibold">Sonderrechte</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          {SPECIAL_KEYS.map((s) => (
            <label key={s} className="flex items-start gap-2 text-[15px]">
              <input type="checkbox" name={`s.${s}`} defaultChecked={permissions.special[s]} disabled={readOnly} className="mt-1" />
              <span>
                <span className="font-medium">{SPECIALS[s]}</span>
                <span className="block text-sm text-ink-400">{SPECIAL_HELP[s]}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      {!readOnly && <Submit>Rolle speichern</Submit>}
    </StateForm>
  );
}
