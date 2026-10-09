import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { db } from "@/lib/db";
import { formatDate } from "@/lib/workspace";
import { pageAccess } from "@/lib/permissions/guard";
import { computeTotals, formatCents, lineNetCents, parseItems, UNIT_LABEL } from "@/lib/invoice";
import { epcPayload } from "@/lib/epc";
import { PrintButton } from "./PrintButton";
import { isDocKind, KIND_LABEL } from "@/lib/invoice";
import { contextFor, documentTexts, paymentUrlFor } from "@/lib/documents/send";

export const dynamic = "force-dynamic";

const nl = (s: string | null | undefined) => (s ?? "").split(/\r?\n/).filter(Boolean);

export default async function PrintPage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const { ws, user } = await pageAccess(slug);
  const inv = await db.invoice.findFirst({ where: { id, workspaceId: ws.id }, include: { contact: true } });
  if (!inv) notFound();
  const kindLabel = isDocKind(inv.kind) ? KIND_LABEL[inv.kind] : "Beleg";
  const isOrder = inv.kind === "ORDER";
  // Personalisierte Texte (individuell am Beleg oder Standardtext des Sub-Accounts)
  const texts = documentTexts(ws, inv, contextFor(ws, inv, user.name, { paymentUrl: await paymentUrlFor(inv) }));
  const items = parseItems(inv.items);
  const t = computeTotals(items);
  const isInvoice = inv.kind === "INVOICE";

  let qrSvg: string | null = null;
  let qrError: string | null = null;
  if (isInvoice && ws.iban && t.grossCents > 0) {
    try {
      qrSvg = await QRCode.toString(epcPayload({ name: ws.legalName ?? ws.name, iban: ws.iban, bic: ws.bic, amountCents: t.grossCents, text: inv.number }), {
        type: "svg", errorCorrectionLevel: "M", margin: 1,
      });
    } catch (e) {
      qrError = (e as Error).message;
    }
  }

  return (
    <div className="mx-auto max-w-[210mm]">
      <style>{`@media print { aside, nav, .no-print { display: none !important; } main { padding: 0 !important; } body { background: #fff !important; } @page { size: A4; margin: 18mm 16mm; } }`}</style>
      <div className="no-print mb-4 flex justify-end"><PrintButton /></div>
      <article className="bg-white p-[14mm] text-[13px] leading-relaxed text-ink-900 shadow-sm print:p-0 print:shadow-none" style={{ fontFamily: ws.fontBody === "System" ? "system-ui" : undefined }}>
        <header className="mb-10 flex items-start justify-between gap-6">
          <div>
            {ws.logoSvg ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img alt={ws.legalName ?? ws.name} className="mb-3 h-12" src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(ws.logoSvg)}`} />
            ) : (
              <div className="mb-3 font-display text-2xl" style={{ color: ws.brandPrimary }}>{ws.legalName ?? ws.name}</div>
            )}
          </div>
          <div className="text-right text-[12px] text-ink-600">
            <div className="font-medium text-ink-900">{ws.legalName ?? ws.name}</div>
            {nl(ws.legalAddress).map((l) => <div key={l}>{l}</div>)}
            {ws.legalPhone && <div>Tel. {ws.legalPhone}</div>}
            {(ws.legalEmail ?? ws.mailFromEmail) && <div>{ws.legalEmail ?? ws.mailFromEmail}</div>}
            {ws.domain && <div>{ws.domain}</div>}
          </div>
        </header>

        <div className="mb-8 text-[11px] text-ink-400">{ws.legalName ?? ws.name} · {nl(ws.legalAddress).join(" · ")}</div>
        <div className="mb-10 flex justify-between gap-6">
          <div>
            <div className="font-medium">{inv.buyerName}</div>
            {nl(inv.buyerAddress).map((l) => <div key={l}>{l}</div>)}
          </div>
          <dl className="grid grid-cols-[auto_auto] gap-x-4 text-right text-[12px]">
            <dt className="text-ink-600">{isInvoice ? "Rechnungsnr." : isOrder ? "AB-Nr." : "Angebotsnr."}</dt><dd className="font-mono">{inv.number}</dd>
            <dt className="text-ink-600">Datum</dt><dd>{formatDate(inv.issueDate)}</dd>
            {(isInvoice || isOrder) && (inv.serviceFrom && inv.serviceTo ? (
              <><dt className="text-ink-600">Leistungszeitraum</dt><dd>{formatDate(inv.serviceFrom)} – {formatDate(inv.serviceTo)}</dd></>
            ) : (
              <><dt className="text-ink-600">Leistungsdatum</dt><dd>{formatDate(inv.serviceFrom ?? inv.issueDate)}</dd></>
            ))}
            {inv.dueDate && !isOrder && <><dt className="text-ink-600">{isInvoice ? "Fällig am" : "Gültig bis"}</dt><dd>{formatDate(inv.dueDate)}</dd></>}
            {inv.customerOrderRef && <><dt className="text-ink-600">Ihre Bestellung</dt><dd>{inv.customerOrderRef}</dd></>}
            {inv.buyerReference && <><dt className="text-ink-600">Ihre Referenz</dt><dd>{inv.buyerReference}</dd></>}
          </dl>
        </div>

        <h1 className="mb-4 font-display text-2xl" style={{ color: ws.brandPrimary }}>{kindLabel} {inv.number}</h1>
        {inv.status === "CANCELLED" && <p className="mb-4 font-semibold text-red-700">STORNIERT</p>}
        {texts.intro && <p className="mb-6 whitespace-pre-line">{texts.intro}</p>}

        <table className="mb-6 w-full text-left">
          <thead>
            <tr className="border-b-2 text-[12px]" style={{ borderColor: ws.brandPrimary }}>
              <th className="py-2 pr-2">Pos.</th><th className="pr-2">Leistung</th><th className="pr-2 text-right">Menge</th><th className="pr-2 text-right">Einzelpreis</th><th className="pr-2 text-right">USt</th><th className="text-right">Netto</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it, i) => (
              <tr key={i} className="border-b border-ink-100 align-top">
                <td className="py-2 pr-2">{i + 1}</td>
                <td className="pr-2">{it.title}</td>
                <td className="pr-2 text-right tabular-nums">{it.qty.toLocaleString("de-DE")} {UNIT_LABEL[it.unit]}</td>
                <td className="pr-2 text-right tabular-nums">{formatCents(it.unitCents, inv.currency)}</td>
                <td className="pr-2 text-right">{it.vatRate} %</td>
                <td className="text-right tabular-nums">{formatCents(lineNetCents(it), inv.currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <dl className="mb-8 ml-auto w-72 space-y-1">
          <div className="flex justify-between"><dt>Summe netto</dt><dd className="tabular-nums">{formatCents(t.netCents, inv.currency)}</dd></div>
          {t.vatGroups.map((g) => (
            <div key={g.rate} className="flex justify-between"><dt>USt {g.rate} % auf {formatCents(g.netCents, inv.currency)}</dt><dd className="tabular-nums">{formatCents(g.vatCents, inv.currency)}</dd></div>
          ))}
          <div className="flex justify-between border-t-2 pt-1 text-[15px] font-semibold" style={{ borderColor: ws.brandPrimary }}><dt>Gesamtbetrag</dt><dd className="tabular-nums">{formatCents(t.grossCents, inv.currency)}</dd></div>
        </dl>
        {t.vatGroups.some((g) => g.rate === 0) && (
          <p className="mb-4 text-[12px] text-ink-600">
            {inv.taxExemptionReason ? `Positionen mit 0 % USt: ${inv.taxExemptionReason}` : "Hinweis: Für Positionen mit 0 % USt fehlt der Befreiungsgrund."}
          </p>
        )}
        {texts.paymentTerms && !isInvoice && <p className="mb-4 whitespace-pre-line">{texts.paymentTerms}</p>}
        {inv.notes && <p className="mb-6 whitespace-pre-line">{inv.notes}</p>}

        {isInvoice && (
          <section className="flex items-start gap-6 border-t border-ink-100 pt-4">
            <div className="flex-1">
              <p className="whitespace-pre-line">{texts.paymentTerms || `Bitte überweisen Sie den Betrag${inv.dueDate ? ` bis ${formatDate(inv.dueDate)}` : ""} unter Angabe der Rechnungsnummer.`}</p>
              {ws.iban && <p className="mt-1 font-mono text-[12px]">IBAN {ws.iban}{ws.bic ? ` · BIC ${ws.bic}` : ""}</p>}
              {qrError && <p className="no-print mt-1 text-[12px] text-red-700">GiroCode nicht möglich: {qrError}</p>}
            </div>
            {qrSvg && (
              <figure className="w-32 text-center">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img alt="GiroCode für die Überweisung" className="w-32" src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(qrSvg)}`} />
                <figcaption className="text-[10px] text-ink-400">GiroCode – mit der Banking-App scannen</figcaption>
              </figure>
            )}
          </section>
        )}

        {texts.outro && <p className="mt-8 whitespace-pre-line">{texts.outro}</p>}
        <footer className="mt-10 border-t border-ink-100 pt-3 text-[10.5px] text-ink-400">
          {ws.legalName ?? ws.name}{ws.legalAddress ? ` · ${nl(ws.legalAddress).join(", ")}` : ""}{ws.vatId ? ` · USt-IdNr. ${ws.vatId}` : ""}
        </footer>
      </article>
    </div>
  );
}
