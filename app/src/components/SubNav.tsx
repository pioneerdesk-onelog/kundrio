"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Reiter-Navigation im Sub-Account mit Markierung der aktuellen Seite.
export function SubNav({ slug, items }: { slug: string; items: readonly (readonly [string, string])[] }) {
  const pathname = usePathname();
  const base = `/sa/${slug}`;
  return (
    <nav aria-label="Bereiche des Sub-Accounts" className="mb-7 flex gap-1 overflow-x-auto border-b md:flex-wrap md:overflow-visible border-ink-100 dark:border-white/10">
      {items.map(([path, label]) => {
        const href = path ? `${base}/${path}` : base;
        const active = path ? pathname === href || pathname.startsWith(`${href}/`) : pathname === base;
        return (
          <Link
            key={path}
            href={href}
            aria-current={active ? "page" : undefined}
            className={`-mb-px shrink-0 whitespace-nowrap border-b-2 px-3 py-2 text-[15px] transition ${
              active
                ? "border-accent-500 font-semibold text-ink-900 dark:border-accent-100 dark:text-ink-50"
                : "border-transparent text-ink-600 hover:border-ink-200 hover:text-ink-900 dark:text-ink-200 dark:hover:text-ink-50"
            }`}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
