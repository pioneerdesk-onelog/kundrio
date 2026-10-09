import Link from "next/link";
import { Badge, Card, Empty, inputCls, labelCls, PageHeader } from "@/components/ui";
import { StateForm, Submit } from "@/components/users/StateForm";
import { NoAccess } from "@/components/users/NoAccess";
import { db } from "@/lib/db";
import { hasSpecial } from "@/lib/permissions";
import { pageAccess } from "@/lib/permissions/guard";
import { describeProvider } from "@/lib/domains/service";
import { createDomainAction } from "./actions";
import { STATUS } from "./status";

export const dynamic = "force-dynamic";



const fmt = (d: Date | null) => (d ? new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short" }).format(d) : "–");

export default async function DomainsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { ws, access } = await pageAccess(slug);
  if (!hasSpecial(access, "manage_settings")) return <NoAccess what="Domains" />;
  const domains = await db.domain.findMany({ where: { workspaceId: ws.id, status: { not: "removed" } }, orderBy: { createdAt: "desc" } });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Eigene Domains"
        description="Landingpages unter Ihrer eigenen Adresse ausliefern (z. B. angebot.ihre-firma.de). Wir erkennen Ihren DNS-Anbieter, tragen die Einträge auf Wunsch automatisch ein und prüfen DNS und HTTPS laufend."
      />
      <Card title="Domain hinzufügen">
        <StateForm action={createDomainAction.bind(null, slug)} className="grid gap-3 md:grid-cols-[2fr_1fr_auto] md:items-end">
          <label className="block">
            <span className={labelCls}>Hostname</span>
            <input name="hostname" placeholder="angebot.ihre-firma.de" required className={inputCls} />
            <span className="mt-1 block text-xs text-ink-400">Empfohlen: eine Subdomain. Die Domain selbst (ohne „www“/Subdomain) geht nur mit festen IP-Adressen und ersetzt dort ggf. Ihre bestehende Website.</span>
          </label>
          <label className="block">
            <span className={labelCls}>Zweck</span>
            <select name="purpose" className={inputCls} defaultValue="landing">
              <option value="landing">Landingpages</option>
              <option value="mail">E-Mail-Versand (SPF/DKIM/DMARC)</option>
            </select>
          </label>
          <Submit>Weiter</Submit>
        </StateForm>
      </Card>
      <Card title="Domains dieses Sub-Accounts">
        {domains.length === 0 ? (
          <Empty>Noch keine eigene Domain eingetragen.</Empty>
        ) : (
          <table className="w-full text-sm">
            <caption className="sr-only">Eigene Domains</caption>
            <thead className="text-left text-ink-400"><tr><th className="py-1">Hostname</th><th>Zweck</th><th>Anbieter</th><th>Status</th><th>Zuletzt geprüft</th></tr></thead>
            <tbody>
              {domains.map((d) => (
                <tr key={d.id} className="border-t border-ink-100 dark:border-white/10">
                  <td className="py-2"><Link className="font-medium text-accent-500 hover:underline dark:text-accent-100" href={`/sa/${slug}/domains/${d.id}`}>{d.hostname}</Link></td>
                  <td>{d.purpose === "mail" ? "E-Mail" : "Landingpages"}</td>
                  <td>{describeProvider(d.dnsProvider).name}</td>
                  <td><Badge tone={STATUS[d.status]?.tone ?? "neutral"}>{STATUS[d.status]?.label ?? d.status}</Badge></td>
                  <td>{fmt(d.lastCheckAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
