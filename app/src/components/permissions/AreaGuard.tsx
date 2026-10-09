import type { ReactNode } from "react";
import { NoAccess } from "@/components/users/NoAccess";
import { pageAccess, meets } from "@/lib/permissions/guard";
import type { Need } from "@/lib/permissions/areas";

// Bereichs-Schutz für Layouts: ohne Recht wird statt des Inhalts ein Hinweis gezeigt.
export async function AreaGuard({ slug, need, what, children }: { slug: string; need: Need; what: string; children: ReactNode }) {
  const { access } = await pageAccess(slug);
  if (!meets(access, need)) return <NoAccess what={what} />;
  return <>{children}</>;
}
