import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "../db";
import { aiChat } from "../ai";
import { htmlToText } from "../c-fetch";
import { normalizeDomain } from "../objects/domain";
import { enrichConfig } from "./config";
import { fetchPage, type FetchedPage } from "./fetch";
import { parseImpressum } from "./impressum";
import { detectSocialLinks, extractLinks, fallbackImpressumUrls, findPages } from "./links";
import { PROFILE_SYSTEM, buildProfilePrompt, parseProfile } from "./profile";
import { parseStructured } from "./structured";
import { isValidGermanVatId } from "./impressum";
import { webSearch } from "./search";
import { writeSuggestions, type SuggestionInput } from "./suggestions";

// Anreicherung eines Unternehmens aus seiner eigenen Website (Startseite, Impressum, Kontakt, Über uns, Team)
// plus KI-Profil. Ergebnis sind ausschließlich Vorschläge (EnrichmentSuggestion).

export type EnrichResult = { ok: boolean; pages: string[]; suggestions: number; notes: string[] };

/** Plattformen, die bei der Suche nach der offiziellen Website nicht als Firmen-Domain gelten. */
const NOT_OFFICIAL = /(linkedin|xing|facebook|instagram|youtube|twitter|x\.com|wikipedia|northdata|kununu|firmenwissen|dasoertliche|gelbeseiten|11880|cylex|wlw|indeed|stepstone|bundesanzeiger|unternehmensregister|handelsregister|google|bing|duckduckgo)\./i;

export async function saveResult(kind: "company" | "contact", id: string, r: EnrichResult & { error?: string }) {
  const key = `enrich:last:${kind}:${id}`;
  const value = { at: new Date().toISOString(), ...r } as Prisma.InputJsonValue;
  await db.appSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
}

/** Website-Seiten holen: Startseite, dann Impressum/Kontakt/Über uns/Team (max. enrichConfig.maxPages). */
export async function crawlCompanySite(base: string, notes: string[]): Promise<{ pages: FetchedPage[]; impressum: FetchedPage | null; byKind: Record<string, FetchedPage[]> }> {
  const pages: FetchedPage[] = [];
  const byKind: Record<string, FetchedPage[]> = { home: [], impressum: [], contact: [], about: [], team: [] };
  const tryFetch = async (url: string) => {
    if (pages.length >= enrichConfig.maxPages || pages.some((p) => p.url === url)) return null;
    try {
      const p = await fetchPage(url);
      if (!p) {
        notes.push(`robots.txt verbietet ${url}`);
        return null;
      }
      pages.push(p);
      return p;
    } catch (e) {
      notes.push(`${url}: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    }
  };
  const home = await tryFetch(base);
  if (!home) return { pages, impressum: null, byKind };
  byKind.home.push(home);
  const links = extractLinks(home.html, home.url);
  const found = findPages(links, home.url);
  let impressum: FetchedPage | null = null;
  for (const u of [...found.impressum, ...fallbackImpressumUrls(home.url)]) {
    impressum = await tryFetch(u);
    if (impressum) {
      byKind.impressum.push(impressum);
      break;
    }
  }
  for (const kind of ["contact", "about", "team"] as const) {
    for (const u of found[kind].slice(0, kind === "team" ? 2 : 1)) {
      const p = await tryFetch(u);
      if (p) byKind[kind].push(p);
    }
  }
  return { pages, impressum, byKind };
}

export async function enrichCompany(workspaceId: string, companyId: string): Promise<EnrichResult> {
  const company = await db.company.findFirst({ where: { id: companyId, workspaceId } });
  if (!company) throw new Error("Unternehmen nicht gefunden.");
  const notes: string[] = [];
  const items: SuggestionInput[] = [];

  const domain = company.domain ?? normalizeDomain(company.website);
  if (!domain) {
    // Ohne Domain: offizielle Website per eigener Suchmaschine vorschlagen (nicht automatisch setzen)
    const results = await webSearch(`"${company.name}" Impressum`, { limit: 10 }).catch((e) => {
      notes.push(`Suche: ${e instanceof Error ? e.message : String(e)}`);
      return [];
    });
    const hit = results.find((r) => !NOT_OFFICIAL.test(new URL(r.url).hostname));
    if (hit) items.push({ field: "domain", value: normalizeDomain(hit.url), sourceUrl: hit.url, sourceKind: "searxng", confidence: 0.5 });
    else notes.push("Keine Website gefunden – bitte Domain manuell eintragen.");
    const { created } = await writeSuggestions(workspaceId, "company", companyId, items);
    return { ok: true, pages: [], suggestions: created, notes };
  }

  const base = company.website?.startsWith("http") ? company.website : `https://${domain}`;
  let crawl = await crawlCompanySite(base, notes);
  if (!crawl.pages.length && !base.includes("://www.")) crawl = await crawlCompanySite(`https://www.${domain}`, notes);
  if (!crawl.pages.length) return { ok: false, pages: [], suggestions: 0, notes };

  // Strukturierte Daten (schema.org JSON-LD) – auch bei Single-Page-Apps im ausgelieferten HTML vorhanden
  const home = crawl.pages[0];
  const sd = parseStructured(home.html);
  const sdPush = (field: string, value: unknown) => items.push({ field, value, sourceUrl: home.url, sourceKind: "website", confidence: 0.85 });
  if (sd.legalName && sd.legalName !== company.name) sdPush("name", sd.legalName);
  sdPush("address", sd.address);
  sdPush("phone", sd.telephone);
  sdPush("email", sd.email);
  if (sd.vatId && (!sd.vatId.startsWith("DE") || isValidGermanVatId(sd.vatId))) sdPush("vatId", sd.vatId);

  // Impressum (deterministisch) – hat Vorrang: gleiche Felder ersetzen die JSON-LD-Vorschläge
  if (crawl.impressum) {
    const d = parseImpressum(htmlToText(crawl.impressum.html).text);
    const src = crawl.impressum.url;
    const push = (field: string, value: unknown) => items.push({ field, value, sourceUrl: src, sourceKind: "impressum", confidence: 0.9 });
    if (d.legalName && d.legalName !== company.name) push("name", d.legalName);
    push("address", d.address);
    push("phone", d.phone);
    push("email", d.email);
    push("registerCourt", d.registerCourt);
    push("registerNumber", d.registerNumber);
    push("vatId", d.vatId);
    push("managingDirectors", d.managingDirectors);
  } else {
    notes.push("Kein Impressum gefunden.");
  }
  if (!company.website) items.push({ field: "website", value: new URL(crawl.pages[0].url).origin, sourceUrl: crawl.pages[0].url, sourceKind: "website", confidence: 0.9 });

  // Social-Profile (nur Links, von der eigenen Website verlinkt)
  const allLinks = [...crawl.pages.flatMap((p) => extractLinks(p.html, p.url)), ...sd.sameAs.map((href) => ({ href, text: "" }))];
  for (const [net, url] of Object.entries(detectSocialLinks(allLinks))) {
    items.push({ field: `socialLinks.${net}`, value: url, sourceUrl: crawl.pages[0].url, sourceKind: "website", confidence: 0.8 });
  }

  // KI-Profil (lokal/EU, protokolliert) – Fehler blockieren die übrigen Vorschläge nicht
  try {
    const texts = crawl.pages.map((p, i) => {
      const t = htmlToText(p.html).text;
      // Meta-/JSON-LD-Beschreibung ergänzen (bei Single-Page-Apps oft der einzige Inhalt)
      const desc = i === 0 && sd.description ? `Beschreibung (Meta/schema.org): ${sd.description}\n\n` : "";
      return { url: p.url.replace(/\/+$/, ""), text: desc + t };
    });
    const raw = await aiChat(workspaceId, "enrich-profile", [
      { role: "system", content: PROFILE_SYSTEM },
      { role: "user", content: buildProfilePrompt(company.name, texts) },
    ]);
    const profile = parseProfile(raw, texts.map((t) => t.url));
    if (profile) {
      items.push({ field: "profile", value: profile, sourceUrl: crawl.pages[0].url, sourceKind: "ai", confidence: 0.6 });
      if (profile.industry) items.push({ field: "industry", value: profile.industry.value, sourceUrl: profile.industry.source, sourceKind: "ai", confidence: 0.6 });
      if (profile.sizeHint) items.push({ field: "size", value: profile.sizeHint.value, sourceUrl: profile.sizeHint.source, sourceKind: "ai", confidence: 0.6 });
    } else {
      notes.push("KI-Profil: keine ausreichend belegten Aussagen.");
    }
  } catch (e) {
    notes.push(`KI-Profil nicht erstellt: ${e instanceof Error ? e.message : String(e)}`);
  }

  const { created } = await writeSuggestions(workspaceId, "company", companyId, items);
  return { ok: true, pages: crawl.pages.map((p) => p.url), suggestions: created, notes };
}
