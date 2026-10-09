import { CreditCard } from "lucide-react";
import { btnCls } from "@/components/ui";
import { CopyButton } from "@/components/mail/CopyButton";
import { paymentLinkFor } from "@/lib/payments/placeholders";

/**
 * Bezahl-Button für eine Rechnung (Server-Komponente). Erscheint nur, wenn ein Zahlungsanbieter verbunden
 * und noch etwas offen ist. Der Link führt auf die eigene Bezahlseite /zahlung/<token>; erst dort wird die
 * Zahlung beim Anbieter angelegt (kein Anlegen beim bloßen Anzeigen, z. B. durch Link-Vorschauen).
 *
 * variant "customer": für Kundenportal/Dokumentseite · "admin": zusätzlich „Link kopieren“
 */
export async function PayButton({ workspaceId, invoiceId, variant = "customer", label = "Online bezahlen" }: { workspaceId: string; invoiceId: string; variant?: "customer" | "admin"; label?: string }) {
  const url = await paymentLinkFor(workspaceId, invoiceId);
  if (!url) return null;
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <a href={url} className={btnCls} target={variant === "admin" ? "_blank" : undefined} rel="noopener noreferrer">
        <CreditCard size={15} aria-hidden /> {label}
      </a>
      {variant === "admin" && <CopyButton text={url} label="Bezahllink kopieren" />}
    </span>
  );
}
