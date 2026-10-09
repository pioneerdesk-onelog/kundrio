import { SubNav } from "@/components/SubNav";
import { pageAccess, meets } from "@/lib/permissions/guard";
import { AREA_NEEDS } from "@/lib/permissions/areas";

const NAV = [
  ["", "Dashboard"],
  ["posteingang", "Posteingang"],
  ["kontakte", "Kontakte"],
  ["unternehmen", "Unternehmen"],
  ["listen", "Listen & Felder"],
  ["anreicherung", "Anreicherung"],
  ["erwaehnungen", "Presse & Erwähnungen"],
  ["pipeline", "Pipeline"],
  ["tickets", "Tickets"],
  ["aufgaben", "Aufgaben"],
  ["kalender", "Kalender"],
  ["email", "E-Mail"],
  ["formulare", "Formulare"],
  ["seiten", "Landingpages"],
  ["analytics", "Analytics"],
  ["prozesse", "Prozesse"],
  ["rechnungen", "Angebote & Rechnungen"],
  ["abos", "Abos"],
  ["zahlungen", "Zahlungen"],
  ["wissen", "Wissen (RAG)"],
  ["wiki", "Wiki"],
  ["kanaele", "Kanäle"],
  ["pflichten", "Pflichten"],
  ["api", "API & Schnittstellen"],
  ["integrationen", "Integrationen"],
  ["domains", "Domains"],
  ["team", "Team"],
  ["einstellungen", "Einstellungen"],
] as const;

export default async function SubAccountLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { ws, access } = await pageAccess(slug);
  // Nur Reiter anzeigen, für die ein Recht besteht
  const items = NAV.filter(([path]) => !path || !AREA_NEEDS[path] || meets(access, AREA_NEEDS[path]));
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-baseline gap-x-3">
        <span className="h-3.5 w-3.5 self-center rounded-full ring-1 ring-black/10" style={{ background: ws.brandPrimary }} aria-hidden />
        <span className="font-display text-2xl text-ink-900 dark:text-ink-50">{ws.name}</span>
        <span className="text-ink-400 dark:text-ink-200">{ws.domain}</span>
      </div>
      <SubNav slug={slug} items={items} />
      {children}
    </div>
  );
}
