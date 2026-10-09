import { StateForm, Submit } from "@/components/users/StateForm";
import { lexwareConfigured, lexwareDeeplink } from "@/lib/lexware/config";
import { getMap, getState } from "@/lib/lexware/sync";
import { pushInvoiceAction } from "./actions";

// Knopf „An Lexware übertragen“ für die Rechnungs-Detailseite (Server-Komponente).
export async function LexwareInvoicePanel({ slug, workspaceId, invoiceId, canEdit }: { slug: string; workspaceId: string; invoiceId: string; canEdit: boolean }) {
  if (!lexwareConfigured()) return null;
  const [state, map] = await Promise.all([getState(workspaceId), getMap(workspaceId)]);
  if (!state.enabled) return null;
  const ref = map.invoices[invoiceId];
  if (ref) {
    return (
      <p className="text-sm text-ink-600 dark:text-ink-200">
        In Lexware: {ref.type === "invoice" ? "Rechnung" : "Angebot"} {ref.voucherNumber ?? "(Entwurf)"} · Status {ref.status ?? "unbekannt"} ·{" "}
        <a className="underline" href={lexwareDeeplink(ref.type, ref.id, ref.finalized ? "view" : "edit")} target="_blank" rel="noreferrer">
          in Lexware öffnen
        </a>
      </p>
    );
  }
  if (!canEdit) return null;
  return (
    <StateForm action={pushInvoiceAction.bind(null, slug, invoiceId)} className="space-y-2">
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="confirm" className="mt-1" />
        <span>Ich übertrage diesen Beleg in die Buchhaltung (Lexware). Das ist nicht rückgängig zu machen.</span>
      </label>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="finalize" className="mt-1" />
        <span>Direkt festschreiben (sonst als Entwurf, in Lexware noch änderbar)</span>
      </label>
      <Submit variant="ghost">An Lexware übertragen</Submit>
    </StateForm>
  );
}
