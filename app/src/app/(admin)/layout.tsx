import { Sidebar } from "@/components/Sidebar";
import { requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

// Interner Bereich: nur mit Anmeldung. Öffentliche Seiten (login, f, c, u, p, api) liegen außerhalb.
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireUser();
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <a href="#inhalt" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-white focus:px-3 focus:py-2 focus:shadow">
        Zum Inhalt springen
      </a>
      <Sidebar />
      <main id="inhalt" className="min-w-0 flex-1 px-4 py-5 md:px-8 md:py-7">
        <div className="mx-auto max-w-7xl">{children}</div>
      </main>
    </div>
  );
}
