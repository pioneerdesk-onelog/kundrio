import { Card } from "@/components/ui";

/** Einheitlicher Sperrhinweis für Bereiche ohne Berechtigung (Sub-Account oder Agentur). */
export function NoAccess({ what = "diesen Bereich", scope = "sub-account" }: { what?: string; scope?: "sub-account" | "agency" }) {
  return (
    <Card>
      <h2 className="mb-1 text-base font-semibold text-ink-900 dark:text-ink-50">Keine Berechtigung</h2>
      <p className="text-[15px] text-ink-600 dark:text-ink-200">
        Für {what} fehlt Ihnen die Berechtigung.{" "}
        {scope === "agency"
          ? "Dieser Bereich ist Inhabern und Admins der Agentur vorbehalten."
          : "Bitte wenden Sie sich an einen Admin dieses Sub-Accounts."}
      </p>
    </Card>
  );
}
