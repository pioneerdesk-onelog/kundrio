import { saveCreditorId } from "@/app/(admin)/sa/[slug]/abos/actions";
import { inputCls, labelCls } from "@/components/ui";
import { StateForm } from "./forms";

/** Gläubiger-Identifikationsnummer für SEPA-Lastschriften (Recht: Einstellungen). Für die Einstellungsseite. */
export function CreditorSettings({ slug, creditorId }: { slug: string; creditorId: string | null }) {
  return (
    <StateForm action={saveCreditorId.bind(null, slug)} submit="Gläubiger-ID speichern">
      <div>
        <label htmlFor="creditorId" className={labelCls}>Gläubiger-Identifikationsnummer</label>
        <input id="creditorId" name="creditorId" defaultValue={creditorId ?? ""} placeholder="DE98ZZZ09999999999" maxLength={35} className={`${inputCls} font-mono`} />
        <p className="mt-1 text-sm text-ink-400 dark:text-ink-200">
          Für SEPA-Lastschriften nötig. Beantragung kostenlos bei der Deutschen Bundesbank (glaeubiger-id.bundesbank.de). Die Prüfziffer wird beim Speichern geprüft.
        </p>
      </div>
    </StateForm>
  );
}
