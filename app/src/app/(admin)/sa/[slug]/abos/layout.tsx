import Link from "next/link";
import { AreaGuard } from "@/components/permissions/AreaGuard";
import { AREA_NEEDS } from "@/lib/permissions/areas";

const TABS = [
  ["", "Abos"],
  ["produkte", "Produkte"],
  ["mandate", "SEPA-Mandate"],
  ["lastschrift", "Lastschrift"],
  ["mahnwesen", "Mahnwesen"],
] as const;

// Bereich Abos & SEPA: ohne Leserecht auf Rechnungen nur ein Hinweis.
export default async function Layout({ children, params }: { children: React.ReactNode; params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return (
    <AreaGuard slug={slug} need={AREA_NEEDS["abos"]} what="Abos & SEPA">
      <nav aria-label="Abos" className="mb-6 flex flex-wrap gap-2 border-b border-ink-100 pb-3 dark:border-white/10">
        {TABS.map(([p, l]) => (
          <Link key={p} href={`/sa/${slug}/abos${p ? `/${p}` : ""}`} className="rounded-md px-3 py-1.5 text-sm font-medium text-ink-800 hover:bg-sand-100 dark:text-ink-100 dark:hover:bg-white/10">
            {l}
          </Link>
        ))}
      </nav>
      {children}
    </AreaGuard>
  );
}
