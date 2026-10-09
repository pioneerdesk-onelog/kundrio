import { AreaGuard } from "@/components/permissions/AreaGuard";

// Bereichs-Schutz: Erwähnungen gehören zu Unternehmen → Leserecht Unternehmen nötig.
export default async function Layout({ children, params }: { children: React.ReactNode; params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return (
    <AreaGuard slug={slug} need={{ object: "companies", action: "read" }} what="Presse & Erwähnungen">
      {children}
    </AreaGuard>
  );
}
