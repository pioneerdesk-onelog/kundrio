import Link from "next/link";
import { db } from "@/lib/db";
import { formatDate } from "@/lib/workspace";
import { can } from "@/lib/permissions";
import { pageAccess } from "@/lib/permissions/guard";
import { formatCents, isDocKind, KIND_LABEL, STATUS_LABEL } from "@/lib/invoice";
import { Badge, Card, Empty, PageHeader, btnCls, btnGhostCls } from "@/components/ui";

export const dynamic = "force-dynamic";

const TONE: Record<string, "neutral" | "accent" | "ok" | "warn" | "bad"> = { DRAFT: "neutral", SENT: "accent", ACCEPTED: "ok", PAID: "ok", CANCELLED: "bad" };

export default async function InvoicesPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ art?: string; status?: string }> }) {
  const { slug } = await params;
  const { art, status } = await searchParams;
  const { ws, access } = await pageAccess(slug);
  const kind = isDocKind(art) ? art : undefined;
  const st = status && STATUS_LABEL[status] ? status : undefined;
  const [list, openSum] = await Promise.all([
    db.invoice.findMany({ where: { workspaceId: ws.id, kind, status: st }, orderBy: [{ issueDate: "desc" }, { number: "desc" }], take: 300 }),
    db.invoice.aggregate({ where: { workspaceId: ws.id, kind: "INVOICE", status: "SENT" }, _sum: { grossCents: true } }),
  ]);
  const now = new Date();
  const link = (q: Record<string, string | undefined>) => {
    const p = new URLSearchParams(Object.entries({ art: kind, status: st, ...q }).filter(([, v]) => v) as [string, string][]);
    return `/sa/${slug}/rechnungen${p.size ? `?${p}` : ""}`;
  };
  const chip = (active: boolean) => `rounded-full px-3 py-1 text-sm ${active ? "bg-accent-500 text-white" : "bg-sand-100 text-ink-800 hover:bg-sand-200 dark:bg-white/10 dark:text-ink-100"}`;

  return (
    <div className="space-y-6">
      <PageHeader title="Angebote & Rechnungen" description={`Offene Forderungen: ${formatCents(openSum._sum.grossCents ?? 0)}`}>
        <Link href={`/sa/${slug}/rechnungen/texte`} className={btnGhostCls}>Texte &amp; Vorlagen</Link>
        {can(access, "invoices", "edit") && <Link href={`/sa/${slug}/rechnungen/neu?art=QUOTE`} className={btnCls}>Neues Angebot</Link>}
        {can(access, "invoices", "edit") && <Link href={`/sa/${slug}/rechnungen/neu?art=INVOICE`} className={btnCls}>Neue Rechnung</Link>}
      </PageHeader>
      <nav aria-label="Filter" className="flex flex-wrap gap-2">
        <Link href={link({ art: undefined })} className={chip(!kind)}>Alle</Link>
        <Link href={link({ art: "QUOTE" })} className={chip(kind === "QUOTE")}>Angebote</Link>
        <Link href={link({ art: "ORDER" })} className={chip(kind === "ORDER")}>Auftragsbestätigungen</Link>
        <Link href={link({ art: "INVOICE" })} className={chip(kind === "INVOICE")}>Rechnungen</Link>
        <span className="mx-2 w-px bg-ink-200" aria-hidden />
        {Object.entries(STATUS_LABEL).map(([k, l]) => (
          <Link key={k} href={link({ status: st === k ? undefined : k })} className={chip(st === k)}>{l}</Link>
        ))}
      </nav>
      <Card>
        {list.length === 0 ? <Empty>Keine Belege gefunden.</Empty> : (
          <div className="overflow-x-auto">
          <table className="w-full text-left text-[15px] [&_td]:pr-3 [&_td]:whitespace-nowrap [&_th]:pr-3">
            <thead className="text-sm text-ink-400"><tr><th className="py-2">Nummer</th><th>Art</th><th>Empfänger</th><th>Datum</th><th>Fällig</th><th className="text-right">Brutto</th><th className="pl-4">Status</th></tr></thead>
            <tbody className="divide-y divide-ink-100 dark:divide-white/10">
              {list.map((i) => {
                const overdue = i.kind === "INVOICE" && i.status === "SENT" && i.dueDate && i.dueDate < now;
                return (
                  <tr key={i.id}>
                    <td className="py-2"><Link className="font-mono text-accent-500 hover:underline dark:text-accent-100" href={`/sa/${slug}/rechnungen/${i.id}`}>{i.number}</Link></td>
                    <td>{isDocKind(i.kind) ? KIND_LABEL[i.kind] : i.kind}</td>
                    <td>{i.buyerName ?? "–"}</td>
                    <td>{formatDate(i.issueDate)}</td>
                    <td className={overdue ? "font-medium text-red-700 dark:text-red-300" : ""}>{formatDate(i.dueDate)}{overdue && " (überfällig)"}</td>
                    <td className="text-right tabular-nums">{formatCents(i.grossCents, i.currency)}</td>
                    <td className="pl-4"><Badge tone={TONE[i.status] ?? "neutral"}>{STATUS_LABEL[i.status] ?? i.status}</Badge></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        )}
      </Card>
      <p className="text-sm text-ink-400 dark:text-ink-200">Bezahlwege: SEPA-Überweisung per GiroCode auf jeder Rechnung, Lastschrift über Abos und – sobald unter „Zahlungen“ ein Anbieter verbunden ist – Online-Zahlung (z. B. Wero) per Bezahllink.</p>
    </div>
  );
}
