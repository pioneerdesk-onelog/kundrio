import Link from "next/link";
import { pageAccess } from "@/lib/permissions/guard";
import { can } from "@/lib/permissions";
import { NoAccess } from "@/components/users/NoAccess";
import { Card, PageHeader, btnGhostCls } from "@/components/ui";
import { ImportForm } from "./ImportForm";

export const dynamic = "force-dynamic";

export default async function ImportPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { ws, access } = await pageAccess(slug);
  if (!can(access, "analytics", "edit")) return <NoAccess what="den Log-Import" />;
  return (
    <div className="max-w-3xl">
      <PageHeader title="Server-Log importieren" description={`KI-Bots auf ${ws.domain ?? "Ihrer Website"} sichtbar machen – sie führen kein JavaScript aus und fehlen sonst in der Statistik.`}>
        <Link href={`/sa/${slug}/analytics`} className={btnGhostCls}>Zurück</Link>
      </PageHeader>
      <Card>
        <ImportForm slug={slug} />
      </Card>
      <Card title="Was passiert mit den Daten?" className="mt-4">
        <ul className="list-disc space-y-1.5 pl-5 text-[15px]">
          <li>Übernommen werden nur Bot-Zugriffe und Besuche, die aus KI-Antworten kommen (ChatGPT, Perplexity, Claude …). Normale Besuche zählt das Skript.</li>
          <li>IP-Adressen werden beim Einlesen verworfen und nie gespeichert. Query-Parameter in Pfaden werden abgeschnitten.</li>
          <li>Bilder, Skripte und Stylesheets werden ignoriert; <code>robots.txt</code>, <code>llms.txt</code> und <code>sitemap.xml</code> bleiben drin.</li>
          <li>Dieselbe Datei zweimal hochladen schadet nicht: bereits importierte Zeilen werden erkannt.</li>
        </ul>
        <p className="mt-3 text-sm text-ink-400 dark:text-ink-200">Typische Pfade: nginx <code>/var/log/nginx/access.log</code>, Apache <code>/var/log/apache2/access.log</code>, Caddy mit <code>log &#123; format json &#125;</code>.</p>
      </Card>
    </div>
  );
}
