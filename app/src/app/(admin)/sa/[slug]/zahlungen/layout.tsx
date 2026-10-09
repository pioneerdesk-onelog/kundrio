import Link from "next/link";
import { AreaGuard } from "@/components/permissions/AreaGuard";
import { AREA_NEEDS } from "@/lib/permissions/areas";
import { PayFeedbackProvider } from "@/components/payments/forms";

const TABS = [
  ["", "Zahlungen"],
  ["abgleich", "Kontoabgleich"],
  ["anbieter", "Anbieter verbinden"],
] as const;

// Bereich Zahlungen: Online-Zahlungen (Bezahllinks), Kontoabgleich, Anbieter. Ohne Leserecht auf Rechnungen nur ein Hinweis.
export default async function Layout({ children, params }: { children: React.ReactNode; params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return (
    <AreaGuard slug={slug} need={AREA_NEEDS["zahlungen"]} what="Zahlungen">
      <nav aria-label="Zahlungen" className="mb-6 flex flex-wrap gap-2 border-b border-ink-100 pb-3 dark:border-white/10">
        {TABS.map(([p, l]) => (
          <Link key={p} href={`/sa/${slug}/zahlungen${p ? `/${p}` : ""}`} className="rounded-md px-3 py-1.5 text-sm font-medium text-ink-800 hover:bg-sand-100 dark:text-ink-100 dark:hover:bg-white/10">
            {l}
          </Link>
        ))}
      </nav>
      <PayFeedbackProvider>{children}</PayFeedbackProvider>
    </AreaGuard>
  );
}
