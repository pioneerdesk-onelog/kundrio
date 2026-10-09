import "server-only";
import { db } from "../db";
import { listProperties } from "../properties";
import { toBrevoCsv, toHubspotCsv, writeCsv, type ExportContact } from "./csv";

// Export für den Weg zurück: Brevo- und HubSpot-Import-CSV sowie Sperrliste.

async function loadContacts(workspaceId: string): Promise<ExportContact[]> {
  const rows = await db.contact.findMany({
    where: { workspaceId, email: { not: null } },
    orderBy: { createdAt: "asc" },
    include: { listMemberships: { include: { list: { select: { name: true } } } } },
  });
  return rows.map((c) => ({
    email: c.email,
    firstName: c.firstName,
    lastName: c.lastName,
    phone: c.phone,
    company: c.company,
    tags: c.tags,
    lists: c.listMemberships.map((m) => m.list.name),
    unsubscribed: !!c.unsubscribedAt,
    consent: !!c.consentEmailAt,
    attributes: (c.attributes as Record<string, unknown>) ?? {},
  }));
}

export async function exportCsv(workspaceId: string, format: "brevo" | "hubspot" | "sperrliste"): Promise<string> {
  if (format === "sperrliste") {
    const rows = await db.suppression.findMany({ where: { workspaceId }, orderBy: { createdAt: "asc" } });
    return writeCsv([["EMAIL", "REASON", "SOURCE", "CREATED_AT"], ...rows.map((s) => [s.email, s.reason, s.source, s.createdAt.toISOString()])]);
  }
  const [contacts, props] = await Promise.all([loadContacts(workspaceId), listProperties(workspaceId)]);
  return format === "brevo" ? toBrevoCsv(contacts, props.map((p) => p.key)) : toHubspotCsv(contacts, props.map((p) => ({ key: p.key, label: p.label })));
}
