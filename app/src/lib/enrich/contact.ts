import "server-only";
import { db } from "../db";
import { htmlToText } from "../c-fetch";
import { emailDomain, isFreemail, normalizeDomain } from "../objects/domain";
import { crawlCompanySite, type EnrichResult } from "./company";
import { jobTitleFromText, matchProfileResult, companyCore, personEnrichmentBlocked } from "./persons-rules";
import { webSearch } from "./search";
import { writeSuggestions, type SuggestionInput } from "./suggestions";

// Anreicherung von Personen – NUR beruflich (ADR-016): Funktion von der Firmen-Website,
// öffentliche berufliche Profil-LINKS (LinkedIn/XING) aus Suchtreffern. Keine Profilinhalte, keine Fotos,
// keine privaten Netzwerke, keine Privatadressen. Nur wenn der Sub-Account es erlaubt und kein Widerspruch vorliegt.

export async function enrichContact(workspaceId: string, contactId: string): Promise<EnrichResult> {
  const [ws, contact] = await Promise.all([
    db.workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: { enrichPersons: true } }),
    db.contact.findFirst({ where: { id: contactId, workspaceId }, include: { companyRecord: true } }),
  ]);
  if (!contact) throw new Error("Kontakt nicht gefunden.");
  const blocked = personEnrichmentBlocked(ws, contact);
  if (blocked) return { ok: false, pages: [], suggestions: 0, notes: [blocked] };
  if (!contact.firstName || !contact.lastName) return { ok: false, pages: [], suggestions: 0, notes: ["Vor- und Nachname werden für einen eindeutigen Abgleich benötigt."] };

  const notes: string[] = [];
  const items: SuggestionInput[] = [];
  const company = contact.companyRecord;
  const companyName = company?.name ?? contact.company ?? null;
  const domEmail = emailDomain(contact.email);
  const domain = company?.domain ?? normalizeDomain(company?.website) ?? (domEmail && !isFreemail(domEmail) ? domEmail : null);

  // 1) Funktion von der Firmen-Website (Team/Impressum/Über uns)
  const pages: string[] = [];
  if (company?.managingDirectors?.some((n) => n.toLowerCase() === `${contact.firstName} ${contact.lastName}`.toLowerCase())) {
    items.push({ field: "jobTitle", value: "Geschäftsführung", sourceUrl: company.website ?? null, sourceKind: "impressum", confidence: 0.9 });
  } else if (domain) {
    const crawl = await crawlCompanySite(company?.website?.startsWith("http") ? company.website : `https://${domain}`, notes);
    pages.push(...crawl.pages.map((p) => p.url));
    for (const p of [...crawl.byKind.team, ...crawl.byKind.impressum, ...crawl.byKind.about, ...crawl.byKind.contact]) {
      const title = jobTitleFromText(htmlToText(p.html).text, contact.firstName, contact.lastName);
      if (title) {
        items.push({ field: "jobTitle", value: title, sourceUrl: p.url, sourceKind: "website", confidence: 0.75 });
        break;
      }
    }
  } else {
    notes.push("Keine Firmen-Website bekannt – Funktion nicht ermittelbar.");
  }

  // 2) Berufliche Profil-Links über die eigene Suchmaschine (nur Treffer mit Name UND Firma)
  if (companyName && companyCore(companyName)) {
    const q = `"${contact.firstName} ${contact.lastName}" "${companyCore(companyName)}" (linkedin OR xing)`;
    const results = await webSearch(q, { limit: 15 }).catch((e) => {
      notes.push(`Suche: ${e instanceof Error ? e.message : String(e)}`);
      return [];
    });
    const seen = new Set<string>();
    for (const r of results) {
      const net = matchProfileResult(r, { firstName: contact.firstName, lastName: contact.lastName, company: companyName });
      if (!net || seen.has(net)) continue;
      seen.add(net);
      items.push({ field: `socialLinks.${net}`, value: r.url.split("?")[0], sourceUrl: r.url, sourceKind: "searxng", confidence: 0.6 });
    }
  } else {
    notes.push("Kein Unternehmen zugeordnet – Profil-Links werden nur mit Firma gesucht.");
  }

  const { created } = await writeSuggestions(workspaceId, "contact", contactId, items);
  return { ok: true, pages, suggestions: created, notes };
}
