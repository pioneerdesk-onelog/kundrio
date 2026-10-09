import "server-only";
import { db } from "../db";
import { emitEvent } from "../events";
import { log } from "../log";
import { analyzeHit, type Analysis } from "./analyze";
import { decideStatus } from "./status";
import { heuristicMatch } from "./match";
import { clipSnippet, dedupeHits, normalizeUrl } from "./names";
import { defaultDeps, searchGdelt, searchSearxng, searchWebsite, type SourceDeps } from "./sources";
import { ALERT_TOPICS, SNIPPET_MAX, type RawHit, type ResearchEntity } from "./types";

// Recherche für ein Unternehmen oder (nur beruflich) einen Kontakt: Quellen abfragen, entdoppeln,
// Verwechslung prüfen, KI-Auswertung, als Mention speichern (nur neue URLs), bei wichtigen Themen Aufgabe + Ereignis.

export type ResearchResult = {
  sources: Record<string, { ok: boolean; hits: number; error?: string }>;
  found: number;
  created: number;
  relevant: number;
  skippedOwnSite: number;
  alerts: number;
};

export type ResearchOptions = {
  deps?: Partial<SourceDeps>;
  /** max. KI-Auswertungen je Lauf (Kosten/Laufzeit) */
  maxAnalyses?: number;
  /** ohne KI (z. B. Tests, Modell nicht erreichbar): nur Heuristik */
  useAi?: boolean;
  timespan?: string;
  /** Monitoring-Lauf: nur Treffer der letzten Zeit melden */
  notify?: boolean;
};


async function loadEntity(workspaceId: string, objectType: "company" | "contact", objectId: string): Promise<{ entity: ResearchEntity; website: string | null; ownerId: string | null; label: string; companyId: string | null } | null> {
  if (objectType === "company") {
    const c = await db.company.findFirst({ where: { id: objectId, workspaceId } });
    if (!c) return null;
    const city = c.address?.match(/\b\d{5}\s+([A-Za-zÄÖÜäöüß .-]{2,40})/)?.[1]?.trim() ?? null;
    return { entity: { kind: "company", companyName: c.name, domain: c.domain, city, industry: c.industry }, website: c.website, ownerId: c.ownerId, label: c.name, companyId: c.id };
  }
  const p = await db.contact.findFirst({ where: { id: objectId, workspaceId }, include: { companyRecord: true, workspace: { select: { enrichPersons: true } } } });
  if (!p) return null;
  // Personen nur, wenn der Sub-Account die berufliche Anreicherung freigeschaltet hat (ADR-016)
  if (!p.workspace.enrichPersons) throw new Error("Recherche zu Personen ist in diesem Sub-Account nicht freigeschaltet (Einstellungen → Anreicherung).");
  const personName = [p.firstName, p.lastName].filter(Boolean).join(" ").trim() || null;
  const companyName = p.companyRecord?.name ?? p.company ?? null;
  if (!personName || !companyName) throw new Error("Für Personen-Recherche werden Name und Firma benötigt (nur beruflicher Bezug).");
  return {
    entity: { kind: "contact", personName, companyName, domain: p.companyRecord?.domain ?? null, industry: p.companyRecord?.industry ?? null },
    website: null,
    ownerId: p.ownerId,
    label: personName,
    companyId: null,
  };
}

export async function researchObject(workspaceId: string, objectType: "company" | "contact", objectId: string, opts: ResearchOptions = {}): Promise<ResearchResult> {
  const deps = { ...defaultDeps(), ...(opts.deps ?? {}) };
  const loaded = await loadEntity(workspaceId, objectType, objectId);
  if (!loaded) throw new Error("Datensatz nicht gefunden");
  const { entity } = loaded;

  const result: ResearchResult = { sources: {}, found: 0, created: 0, relevant: 0, skippedOwnSite: 0, alerts: 0 };
  const all: RawHit[] = [];
  const run = async (name: string, fn: () => Promise<RawHit[]>) => {
    try {
      const hits = await fn();
      result.sources[name] = { ok: true, hits: hits.length };
      all.push(...hits);
    } catch (e) {
      // Eine ausgefallene Quelle stoppt die übrigen nicht – Fehler wird sichtbar zurückgegeben
      result.sources[name] = { ok: false, hits: 0, error: String(e instanceof Error ? e.message : e).slice(0, 200) };
    }
  };
  // Personen-Namen gehen nicht an GDELT (USA) – Datenminimierung; bei Kontakten nur eigene Suchmaschine
  if (objectType === "company" && process.env.RESEARCH_GDELT !== "off") await run("gdelt", () => searchGdelt(entity, deps, { timespan: opts.timespan }));
  await run("searxng", () => searchSearxng(entity, deps));
  if (objectType === "company") await run("website", () => searchWebsite(entity, deps, loaded.website));

  const hits = dedupeHits(all);
  result.found = hits.length;

  // Bereits gespeicherte URLs überspringen (idempotent)
  const where = objectType === "company" ? { companyId: objectId } : { contactId: objectId };
  const existing = new Set((await db.mention.findMany({ where: { workspaceId, ...where }, select: { url: true } })).map((m) => m.url));

  let analyses = 0;
  const maxAnalyses = opts.maxAnalyses ?? 10;
  // Neueste zuerst analysieren
  const ordered = hits
    .filter((h) => !existing.has(normalizeUrl(h.url) ?? h.url))
    .sort((a, b) => (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0));

  for (const h of ordered) {
    const match = heuristicMatch(h, entity);
    // Eigene Pressemitteilungen von der Website sind gewollt; Fremdtreffer von der eigenen Domain (Suchmaschinen) nicht
    if (match.ownSite && h.sourceKind !== "website" && h.sourceKind !== "rss") {
      result.skippedOwnSite++;
      continue;
    }
    // Ohne jeden Namensbezug gar nicht erst speichern
    if (match.score < 0.2) continue;

    let analysis: Analysis | null = null;
    if (opts.useAi !== false && analyses < maxAnalyses) {
      analyses++;
      try {
        analysis = await analyzeHit(workspaceId, entity, h);
      } catch (e) {
        log.warn("research: KI-Auswertung fehlgeschlagen", { error: e instanceof Error ? e.message : String(e) });
      }
    }
    const { status, uncertain } = decideStatus(match.score, analysis);
    if (status === "irrelevant") continue; // sicher Verwechslung → nicht speichern
    const summary = analysis?.summary ?? null;
    const note = uncertain ? `Hinweis: Zuordnung unsicher (${match.reasons.join(", ")}). ` : "";
    try {
      const m = await db.mention.create({
        data: {
          workspaceId,
          companyId: objectType === "company" ? objectId : null,
          contactId: objectType === "contact" ? objectId : null,
          url: normalizeUrl(h.url) ?? h.url,
          title: h.title.slice(0, 500),
          sourceHost: h.sourceHost ?? null,
          sourceKind: h.sourceKind,
          language: h.language ?? null,
          publishedAt: h.publishedAt ?? null,
          snippet: clipSnippet(h.snippet, SNIPPET_MAX),
          summary: summary || note ? `${note}${summary ?? ""}`.trim().slice(0, 900) : null,
          sentiment: analysis?.sentiment ?? null,
          relevance: analysis?.relevance ?? null,
          topics: analysis?.topics ?? [],
          status,
        },
      });
      result.created++;
      if (status === "relevant") {
        result.relevant++;
        if (opts.notify !== false) {
          await emitEvent({ workspaceId, type: "mention.found", objectType, objectId, data: { mentionId: m.id, topics: m.topics, sentiment: m.sentiment } });
          const alertTopics = m.topics.filter((t) => (ALERT_TOPICS as string[]).includes(t));
          if (alertTopics.length) {
            result.alerts++;
            await db.task.create({
              data: {
                workspaceId,
                title: `Neue Erwähnung prüfen: ${loaded.label} – ${alertTopics.join(", ")}`.slice(0, 200),
                dueAt: new Date(Date.now() + 864e5),
                contactId: objectType === "contact" ? objectId : null,
                ownerId: loaded.ownerId,
              },
            });
          }
        }
      }
    } catch (e) {
      // Eindeutigkeit (gleiche URL parallel gespeichert) ist kein Fehler
      if (!(e instanceof Error && /Unique constraint/i.test(e.message))) throw e;
    }
  }

  return result;
}
