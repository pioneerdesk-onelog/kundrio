import { AreaGuard } from "@/components/permissions/AreaGuard";
import { AREA_NEEDS } from "@/lib/permissions/areas";

// Bereichs-Schutz: ohne Leserecht wird ein Hinweis statt des Inhalts gezeigt.
export default async function Layout({ children, params }: { children: React.ReactNode; params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return (
    <AreaGuard slug={slug} need={AREA_NEEDS["api"]} what="API & Schnittstellen">
      {children}
    </AreaGuard>
  );
}
