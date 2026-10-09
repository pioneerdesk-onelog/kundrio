import Link from "next/link";
import { Download } from "lucide-react";
import { Card, PageHeader, btnGhostCls } from "@/components/ui";
import { removeLogo, saveFourEyes, saveLogo, saveSettings } from "./actions";
import { FourEyesForm } from "@/components/users/FourEyesForm";
import { hasSpecial } from "@/lib/permissions";
import { pageAccess } from "@/lib/permissions/guard";
import { SettingsForm } from "./SettingsForm";
import { LogoForm } from "./LogoForm";
import { BrandSection } from "@/components/brand/BrandSection";
import { CreditorSettings } from "@/components/billing/CreditorSettings";

export const dynamic = "force-dynamic";

export default async function SettingsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { ws, access } = await pageAccess(slug);
  const canEdit = hasSpecial(access, "manage_settings");
  const canManageSettings = canEdit;
  // Vollständiger Export: alle Tabellen → Einstellungen verwalten + Daten exportieren
  const canExport = canEdit && hasSpecial(access, "export");
  return (
    <div>
      <PageHeader title="Einstellungen" description={`Kurzname in der URL: ${ws.slug} (nicht änderbar)`} />
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <Card>
          <SettingsForm ws={ws} action={saveSettings.bind(null, slug)} canEdit={canEdit} />
        </Card>
        <div className="space-y-6">
          <Card title="Logo">
            <LogoForm action={saveLogo.bind(null, slug)} remove={removeLogo.bind(null, slug)} logoSvg={ws.logoSvg} canEdit={canEdit} />
          </Card>
          <Card title="SEPA-Lastschrift">
            {canEdit ? (
              <CreditorSettings slug={slug} creditorId={ws.creditorId} />
            ) : (
              <p className="text-[15px] text-ink-600 dark:text-ink-200">Gläubiger-ID: {ws.creditorId ?? "nicht hinterlegt"}</p>
            )}
          </Card>
          <Card title="Freigaben">
            <FourEyesForm action={saveFourEyes.bind(null, slug)} enabled={ws.fourEyes} canEdit={canManageSettings} />
          </Card>
          <Card title="Datenexport">
            <p className="mb-3 text-[15px] text-ink-600 dark:text-ink-200">
              Alle Daten dieses Sub-Accounts als ZIP (JSON + CSV, offene Formate). Ohne Passwörter und Embeddings.
            </p>
            {canExport ? (
              <Link href={`/sa/${slug}/einstellungen/export`} prefetch={false} className={btnGhostCls}><Download size={16} aria-hidden /> Export herunterladen</Link>
            ) : (
              <p className="text-sm text-ink-400">Dafür fehlt das Recht „Daten exportieren“.</p>
            )}
          </Card>
        </div>
      </div>
      <Card title="Marke & CI" className="mt-6">
        <p className="mb-4 max-w-prose text-[15px] text-ink-600 dark:text-ink-200">
          Brandbook hochladen, die Website auswerten oder alles bzw. Teile manuell pflegen. Gefundene Werte erscheinen als Vorschläge mit Quelle – übernommen wird erst nach Ihrer Prüfung.
        </p>
        <BrandSection slug={slug} ws={ws} canEdit={canEdit} />
      </Card>
    </div>
  );
}
