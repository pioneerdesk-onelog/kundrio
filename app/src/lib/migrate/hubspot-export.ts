import "server-only";
import { db } from "../db";
import { writeCsv } from "./csv";

// Export für den Weg zurück nach HubSpot: Unternehmen, Deals und Tickets im HubSpot-Importformat.
// Verknüpfungen über die von HubSpot erkannten Schlüssel (Kontakt-E-Mail, Unternehmens-Domain).

const LC_TO_HS: Record<string, string> = {
  subscriber: "subscriber", lead: "lead", mql: "marketingqualifiedlead", sql: "salesqualifiedlead",
  opportunity: "opportunity", customer: "customer", evangelist: "evangelist", other: "other",
};
const PRIO_TO_HS: Record<string, string> = { low: "LOW", medium: "MEDIUM", high: "HIGH", urgent: "URGENT" };

async function props(workspaceId: string, objectType: string) {
  return db.propertyDefinition.findMany({ where: { workspaceId, objectType }, orderBy: { label: "asc" } });
}
const attr = (a: unknown, key: string) => {
  const v = (a as Record<string, unknown> | null)?.[key];
  return v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
};
const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");

export async function exportHubspotObjects(workspaceId: string, kind: "companies" | "deals" | "tickets"): Promise<string> {
  if (kind === "companies") {
    const [rows, defs] = await Promise.all([
      db.company.findMany({ where: { workspaceId }, orderBy: { createdAt: "asc" }, include: { owner: { select: { email: true } } } }),
      props(workspaceId, "company"),
    ]);
    return writeCsv([
      ["Name", "Company domain name", "Industry", "Phone number", "Street address", "Website URL", "Number of employees", "Lifecycle stage", "Company owner", ...defs.map((d) => d.label)],
      ...rows.map((c) => [c.name, c.domain, c.industry, c.phone, c.address, c.website, c.size, c.lifecycleStage ? LC_TO_HS[c.lifecycleStage] ?? c.lifecycleStage : "", c.owner?.email, ...defs.map((d) => attr(c.attributes, d.key))]),
    ]);
  }
  if (kind === "deals") {
    // Deals haben (noch) keine eigenen Felder im Schema → nur Standardspalten
    const [rows] = await Promise.all([
      db.deal.findMany({
        where: { workspaceId },
        orderBy: { createdAt: "asc" },
        include: { pipeline: true, stage: true, contact: { select: { email: true } }, company: { select: { domain: true, name: true } }, owner: { select: { email: true } } },
      }),
    ]);
    return writeCsv([
      ["Deal name", "Amount", "Pipeline", "Deal stage", "Close date", "Create date", "Deal owner", "Email", "Company domain name", "Company name"],
      ...rows.map((d) => [d.title, (d.valueCents / 100).toFixed(2), d.pipeline.name, d.stage.name, day(d.closedAt), day(d.createdAt), d.owner?.email, d.contact?.email, d.company?.domain, d.company?.name]),
    ]);
  }
  const [rows, defs] = await Promise.all([
    db.ticket.findMany({
      where: { workspaceId },
      orderBy: { createdAt: "asc" },
      include: { pipeline: true, stage: true, contact: { select: { email: true } }, company: { select: { domain: true, name: true } }, owner: { select: { email: true } } },
    }),
    props(workspaceId, "ticket"),
  ]);
  return writeCsv([
    ["Ticket name", "Ticket description", "Pipeline", "Ticket status", "Priority", "Source", "Create date", "Close date", "Ticket owner", "Email", "Company domain name", ...defs.map((d) => d.label)],
    ...rows.map((t) => [t.subject, t.description, t.pipeline.name, t.stage.name, PRIO_TO_HS[t.priority] ?? t.priority, t.source, day(t.createdAt), day(t.closedAt), t.owner?.email, t.contact?.email, t.company?.domain, ...defs.map((d) => attr(t.attributes, d.key))]),
  ]);
}
