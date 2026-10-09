"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";

// Auf schmalen Bildschirmen (< md) ist die Seitenleiste eingeklappt und über „Menü“ zu öffnen;
// ab md immer sichtbar. Nach einem Seitenwechsel klappt das Menü wieder zu.
export function SidebarMenu({ brand, children }: { brand: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  useEffect(() => setOpen(false), [pathname]);
  return (
    <>
      <div className="flex items-start justify-between gap-3 md:mb-6">
        {brand}
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-md border border-ink-200 px-3 py-1.5 text-sm font-medium text-ink-800 md:hidden dark:border-white/15 dark:text-ink-50"
          aria-expanded={open}
          aria-controls="hauptmenue"
          onClick={() => setOpen((o) => !o)}
          onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
        >
          {open ? <X size={16} aria-hidden /> : <Menu size={16} aria-hidden />} Menü
        </button>
      </div>
      <div id="hauptmenue" className={`${open ? "flex" : "hidden"} mt-4 min-h-0 flex-1 flex-col md:mt-0 md:flex`}>
        {children}
      </div>
    </>
  );
}
