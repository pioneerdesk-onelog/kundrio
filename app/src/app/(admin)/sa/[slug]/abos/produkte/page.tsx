import { db } from "@/lib/db";
import { can } from "@/lib/permissions";
import { pageAccess } from "@/lib/permissions/guard";
import { formatCents } from "@/lib/invoice";
import { INTERVAL_LABEL, INTERVALS, isInterval } from "@/lib/billing/periods";
import { Badge, Card, Empty, PageHeader, btnGhostCls, inputCls, labelCls } from "@/components/ui";
import { StateForm } from "@/components/billing/forms";
import { saveProduct, toggleProduct } from "../actions";

export const dynamic = "force-dynamic";

function ProductFields({ p }: { p?: { name: string; description: string | null; unitCents: number; vatRate: number; interval: string } }) {
  const id = (k: string) => `${k}-${p ? "e" : "n"}${p?.name.length ?? ""}`;
  return (
    <div className="grid gap-3 sm:grid-cols-[2fr_1fr_6rem_1fr]">
      <div>
        <label htmlFor={id("name")} className={labelCls}>Name</label>
        <input id={id("name")} name="name" required maxLength={200} defaultValue={p?.name} className={inputCls} />
      </div>
      <div>
        <label htmlFor={id("price")} className={labelCls}>Preis netto (€)</label>
        <input id={id("price")} name="price" required inputMode="decimal" defaultValue={p ? (p.unitCents / 100).toLocaleString("de-DE", { minimumFractionDigits: 2 }) : ""} className={inputCls} />
      </div>
      <div>
        <label htmlFor={id("vat")} className={labelCls}>USt</label>
        <select id={id("vat")} name="vatRate" defaultValue={p?.vatRate ?? 19} className={inputCls}>
          <option value={19}>19 %</option><option value={7}>7 %</option><option value={0}>0 %</option>
        </select>
      </div>
      <div>
        <label htmlFor={id("int")} className={labelCls}>Rhythmus</label>
        <select id={id("int")} name="interval" defaultValue={p?.interval ?? "monthly"} className={inputCls}>
          {INTERVALS.map((i) => <option key={i} value={i}>{INTERVAL_LABEL[i]}</option>)}
        </select>
      </div>
      <div className="sm:col-span-4">
        <label htmlFor={id("desc")} className={labelCls}>Beschreibung (optional)</label>
        <input id={id("desc")} name="description" maxLength={1000} defaultValue={p?.description ?? ""} className={inputCls} />
      </div>
    </div>
  );
}

export default async function ProductsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { ws, access } = await pageAccess(slug);
  const products = await db.product.findMany({ where: { workspaceId: ws.id }, orderBy: [{ active: "desc" }, { name: "asc" }] });
  const editable = can(access, "invoices", "edit");
  return (
    <div className="space-y-6">
      <PageHeader title="Produkte" description="Katalog für Abos: Preise netto, Steuersatz und Abrechnungsrhythmus. Änderungen gelten für neue Abos." />
      {editable && (
        <Card title="Neues Produkt">
          <StateForm action={saveProduct.bind(null, slug, null)} submit="Produkt anlegen"><ProductFields /></StateForm>
        </Card>
      )}
      <Card title="Katalog">
        {products.length === 0 ? <Empty>Noch keine Produkte.</Empty> : (
          <ul className="divide-y divide-ink-100 dark:divide-white/10">
            {products.map((p) => (
              <li key={p.id} className="py-3">
                <details>
                  <summary className="flex cursor-pointer flex-wrap items-center gap-3">
                    <span className="font-medium">{p.name}</span>
                    <span className="tabular-nums">{formatCents(p.unitCents)} netto</span>
                    <span className="text-sm text-ink-400">{p.vatRate} % · {isInterval(p.interval) ? INTERVAL_LABEL[p.interval] : p.interval}</span>
                    {!p.active && <Badge tone="neutral">inaktiv</Badge>}
                  </summary>
                  {editable && (
                    <div className="mt-3 space-y-3">
                      <StateForm action={saveProduct.bind(null, slug, p.id)} submit="Speichern"><ProductFields p={p} /></StateForm>
                      <form action={toggleProduct.bind(null, slug, p.id)}><button className={btnGhostCls}>{p.active ? "Deaktivieren" : "Aktivieren"}</button></form>
                    </div>
                  )}
                </details>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
