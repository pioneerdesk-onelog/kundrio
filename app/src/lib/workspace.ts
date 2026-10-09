import "server-only";
import { notFound } from "next/navigation";
import { cache } from "react";
import { db } from "./db";
import { canAccessWorkspace, requireUser } from "./auth";

/** Sub-Accounts, die der angemeldete Benutzer sehen darf. */
export const listWorkspaces = cache(async () => {
  const user = await requireUser();
  return db.workspace.findMany({
    where: user.isAgencyAdmin || user.agencyRole === "owner" || user.agencyRole === "admin" ? {} : { memberships: { some: { userId: user.id } } },
    orderBy: { name: "asc" },
  });
});

/**
 * Lädt den Sub-Account zur URL. Prüft Anmeldung und Berechtigung; sonst Login bzw. 404.
 * Grundlage jeder Seite und jeder Server Action im internen Bereich.
 */
export const getWorkspace = cache(async (slug: string) => {
  const user = await requireUser();
  const ws = await db.workspace.findUnique({ where: { slug } });
  if (!ws || !canAccessWorkspace(user, ws.id)) notFound();
  return ws;
});

export function formatNumber(n: number) {
  return n.toLocaleString("de-DE");
}

export function formatEuro(cents: number) {
  return new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(cents / 100);
}

export function formatDate(d: Date | null | undefined, withTime = false) {
  if (!d) return "–";
  return new Intl.DateTimeFormat("de-DE", withTime ? { dateStyle: "medium", timeStyle: "short" } : { dateStyle: "medium" }).format(d);
}
