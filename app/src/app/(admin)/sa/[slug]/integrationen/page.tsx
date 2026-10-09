import { Badge, Card, PageHeader } from "@/components/ui";
import { StateForm, Submit } from "@/components/users/StateForm";
import { NoAccess } from "@/components/users/NoAccess";
import { db } from "@/lib/db";
import { lexwareConfigured } from "@/lib/lexware/config";
import { getMap, getState } from "@/lib/lexware/sync";
import { can, hasSpecial } from "@/lib/permissions";
import { pageAccess } from "@/lib/permissions/guard";
import { importFromLexware, pushCustomersAction, syncNow, testLexware, toggleLexware } from "./actions";

export const dynamic = "force-dynamic";

const fmt = (iso?: string) => (iso ? new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso)) : "–");

export default async function IntegrationenPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { ws, access } = await pageAccess(slug);
  const canRead = can(access, "invoices", "read") || hasSpecial(access, "manage_settings");
  if (!canRead) return <NoAccess what="Integrationen" />;
  const canEdit = can(access, "invoices", "edit");
  const canSettings = hasSpecial(access, "manage_settings");
  const canImport = hasSpecial(access, "import");

  const configured = lexwareConfigured();
  const [state, map] = await Promise.all([getState(ws.id), getMap(ws.id)]);
  const invoiceIds = Object.keys(map.invoices);
  const invoices = invoiceIds.length ? await db.invoice.findMany({ where: { workspaceId: ws.id, id: { in: invoiceIds } }, select: { id: true, number: true, status: true } }) : [];

  return (
    <div className="space-y-6">
      <PageHeader title="Integrationen" description="Anbindungen an externe Systeme. Jede Übertragung wird protokolliert; Daten lassen sich jederzeit auch wieder zurückholen." />

      <Card title={<span className="flex items-center gap-2">Lexware Office {configured ? (state.enabled ? <Badge tone="ok">aktiv</Badge> : <Badge>inaktiv</Badge>) : <Badge tone="warn">kein Schlüssel</Badge>}</span>}>
        {!configured ? (
          <p className="text-ink-600 dark:text-ink-200">
            Es ist kein Lexware-Schlüssel hinterlegt. Den API-Schlüssel erzeugen Sie in Lexware unter <em>Erweiterungen → Public API</em> (Tarif XL) und tragen ihn als{" "}
            <code>LEXWARE_API_KEY</code> in die Server-Konfiguration ein. Er wird nie in der Datenbank gespeichert.
          </p>
        ) : (
          <div className="space-y-5">
            <div className="flex flex-wrap gap-3">
              <StateForm action={testLexware.bind(null, slug)} inline>
                <Submit variant="ghost">Verbindung testen</Submit>
              </StateForm>
              {canSettings && (
                <StateForm action={toggleLexware.bind(null, slug)} inline>
                  <input type="hidden" name="enable" value={state.enabled ? "0" : "1"} />
                  <Submit variant={state.enabled ? "danger" : "primary"}>{state.enabled ? "Für diesen Sub-Account deaktivieren" : "Für diesen Sub-Account aktivieren"}</Submit>
                </StateForm>
              )}
              {state.enabled && canEdit && (
                <StateForm action={syncNow.bind(null, slug)} inline>
                  <Submit variant="ghost">Zahlungsstatus jetzt abgleichen</Submit>
                </StateForm>
              )}
            </div>

            <dl className="grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
              <div><dt className="text-ink-400">Zuletzt abgeglichen</dt><dd>{fmt(state.lastSync)}</dd></div>
              <div><dt className="text-ink-400">Kontakte zugeordnet</dt><dd>{Object.keys(map.contacts).length}</dd></div>
              <div><dt className="text-ink-400">Unternehmen zugeordnet</dt><dd>{Object.keys(map.companies).length}</dd></div>
              <div><dt className="text-ink-400">Belege übertragen</dt><dd>{invoiceIds.length}</dd></div>
            </dl>

            {state.enabled && (canEdit || canImport) && (
              <div className="grid gap-4 md:grid-cols-2">
                {canEdit && (
                  <div className="rounded-lg border border-ink-100 p-4 dark:border-white/10">
                    <h3 className="mb-2 font-semibold">Kunden → Lexware</h3>
                    <p className="mb-3 text-sm text-ink-600 dark:text-ink-200">Überträgt Kontakte mit Lifecycle „Kunde“ oder mit Belegen; Unternehmen als Firmenkunde mit Ansprechpartner.</p>
                    <StateForm action={pushCustomersAction.bind(null, slug)}>
                      <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="confirm" className="mt-1" /> Kunden in die Buchhaltung übertragen</label>
                      <Submit>Kunden übertragen</Submit>
                    </StateForm>
                  </div>
                )}
                {canImport && (
                  <div className="rounded-lg border border-ink-100 p-4 dark:border-white/10">
                    <h3 className="mb-2 font-semibold">Lexware → CRM</h3>
                    <p className="mb-3 text-sm text-ink-600 dark:text-ink-200">Importiert Lexware-Kunden (Abgleich per E-Mail bzw. Firmenname). Importe lösen keine Prozesse aus.</p>
                    <StateForm action={importFromLexware.bind(null, slug)}>
                      <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="confirm" className="mt-1" /> Kunden aus Lexware importieren</label>
                      <Submit variant="ghost">Importieren</Submit>
                    </StateForm>
                  </div>
                )}
              </div>
            )}

            {invoices.length > 0 && (
              <div>
                <h3 className="mb-2 font-semibold">Übertragene Belege</h3>
                <table className="w-full text-sm">
                  <thead className="text-left text-ink-400"><tr><th className="py-1">Beleg</th><th>Typ</th><th>Lexware-Status</th><th>Status im CRM</th><th>Übertragen</th></tr></thead>
                  <tbody>
                    {invoices.map((i) => {
                      const r = map.invoices[i.id];
                      return (
                        <tr key={i.id} className="border-t border-ink-100 dark:border-white/10">
                          <td className="py-1.5"><a className="underline" href={`/sa/${slug}/rechnungen/${i.id}`}>{i.number}</a></td>
                          <td>{r.type === "invoice" ? "Rechnung" : "Angebot"}</td>
                          <td>{r.status ?? "–"}{r.voucherNumber ? ` (${r.voucherNumber})` : ""}</td>
                          <td>{i.status}</td>
                          <td>{fmt(r.pushedAt)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            <div>
              <h3 className="mb-2 font-semibold">Protokoll</h3>
              {state.log.length === 0 ? (
                <p className="text-sm text-ink-400">Noch keine Synchronisation.</p>
              ) : (
                <ul className="divide-y divide-ink-100 text-sm dark:divide-white/10">
                  {state.log.map((l, i) => (
                    <li key={i} className="flex gap-3 py-1.5">
                      <span className="w-40 shrink-0 text-ink-400">{fmt(l.at)}</span>
                      <Badge tone={l.ok ? "ok" : "bad"}>{l.ok ? "ok" : "Fehler"}</Badge>
                      <span><strong>{l.action}</strong> – {l.detail}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
