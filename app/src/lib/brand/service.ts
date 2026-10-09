import "server-only";
import { db } from "../db";
import { htmlToText } from "../c-fetch";
import { sanitizeSvg } from "../svg-sanitize";
import { readStoredFile, storeFile } from "../storage";
import { detectFileType } from "../storage/validate";
import { isNeutral } from "./colors";
import { colorInfo, suggestionsFromAi, suggestionsFromText } from "./derive";
import { analyzeCss, findLogoCandidates, inlineStyles, pickBrandColors, stylesheetLinks } from "./css";
import { extractSections, type Section } from "./extract";
import { fetchRaw } from "./fetch";
import { summarizeGuide } from "./ai-guide";
import { proposeBrand, type NewSuggestion } from "./suggestions";

// Auswertung von Brandbook-Dateien bzw. Website → Vorschläge. Deterministische Werte zuerst;
// die KI-Zusammenfassung (Markenstimme etc.) ist eine Ergänzung – fällt sie aus, bleiben die übrigen Vorschläge.

/** Brandbook-Dateien auswerten. */
export async function extractFromFiles(workspaceId: string, fileIds: string[]) {
  const sections: Section[] = [];
  const items: NewSuggestion[] = [];
  const names: string[] = [];
  for (const id of fileIds.slice(0, 10)) {
    const r = await readStoredFile(workspaceId, id);
    if (!r) continue;
    names.push(r.file.name);
    if (r.file.mime === "image/svg+xml") {
      try {
        items.push({ field: "logoSvg", sourceKind: "brandbook", sourceUrl: r.file.name, confidence: /logo/i.test(r.file.name) ? 0.9 : 0.5, value: { svg: sanitizeSvg(r.data.toString("utf8")) } });
      } catch {
        /* SVG nicht verwendbar */
      }
      continue;
    }
    if (r.file.mime.startsWith("image/")) {
      if (/logo|signet|wortmarke/i.test(r.file.name)) items.push({ field: "logoFile", sourceKind: "brandbook", sourceUrl: r.file.name, confidence: 0.7, value: { fileId: r.file.id, name: r.file.name } });
      continue;
    }
    sections.push(...(await extractSections(r.file.name, r.file.mime, r.data)));
  }
  const ref = names.join(", ").slice(0, 300) || "Brandbook";
  items.push(...suggestionsFromText(sections, "brandbook", ref));
  let aiError: string | undefined;
  if (sections.length) {
    try {
      items.push(...suggestionsFromAi(await summarizeGuide(workspaceId, sections, "brandbook"), "brandbook", ref));
    } catch (e) {
      aiError = e instanceof Error ? e.message : String(e);
    }
  }
  const created = await proposeBrand(workspaceId, items);
  return { created, sections: sections.length, aiError };
}

/** Website-CI auswerten (Startseite + verlinkte Stylesheets). */
export async function extractFromWebsite(workspaceId: string, domainOrUrl: string, createdBy?: string) {
  const start = /^https?:\/\//.test(domainOrUrl) ? domainOrUrl : `https://${domainOrUrl}`;
  const home = await fetchRaw(start, { maxBytes: 2 * 1024 * 1024, accept: "text/html,application/xhtml+xml" });
  const html = home.body.toString("utf8");
  let css = inlineStyles(html);
  for (const href of stylesheetLinks(html, home.url, 5)) {
    try {
      const r = await fetchRaw(href, { maxBytes: 1024 * 1024, accept: "text/css,*/*;q=0.1" });
      css += `\n${r.body.toString("utf8")}`;
    } catch {
      /* einzelnes Stylesheet nicht erreichbar */
    }
  }
  const analysis = analyzeCss(css, html);
  const picked = pickBrandColors(analysis);
  const items: NewSuggestion[] = [];
  const ref = home.url;
  if (picked.primary) items.push({ field: "brandPrimary", sourceKind: "website", sourceUrl: ref, confidence: picked.reason.primary.startsWith("CSS-Variable") ? 0.85 : 0.6, value: colorInfo(picked.primary, picked.reason.primary) });
  if (picked.accent) items.push({ field: "brandAccent", sourceKind: "website", sourceUrl: ref, confidence: picked.reason.accent.startsWith("CSS-Variable") ? 0.8 : 0.5, value: colorInfo(picked.accent, picked.reason.accent) });
  const palette = analysis.colors.filter((c) => !isNeutral(c.hex)).slice(0, 8);
  if (palette.length) {
    items.push({
      field: "guide.colors",
      sourceKind: "website",
      sourceUrl: ref,
      confidence: 0.6,
      value: { data: palette.map((c) => ({ name: c.hex === picked.primary ? "Primär (Website)" : c.hex === picked.accent ? "Akzent (Website)" : "", hex: c.hex, role: c.hex === picked.primary ? "primary" : c.hex === picked.accent ? "accent" : "other", source: ref })) },
    });
  }
  const fonts = [...analysis.fonts, ...analysis.googleFonts.filter((g) => !analysis.fonts.includes(g))];
  if (fonts.length) {
    items.push({ field: "fontHeading", sourceKind: "website", sourceUrl: ref, confidence: 0.5, value: { font: fonts[0] } });
    items.push({ field: "fontBody", sourceKind: "website", sourceUrl: ref, confidence: 0.5, value: { font: fonts[1] ?? fonts[0] } });
    items.push({
      field: "guide.typography",
      sourceKind: "website",
      sourceUrl: ref,
      confidence: 0.6,
      value: {
        data: {
          heading: fonts[0],
          body: fonts[1] ?? fonts[0],
          others: fonts.slice(2),
          googleFonts: analysis.googleFonts,
          notes: analysis.googleFonts.length ? "Die Website lädt Schriften von Google Fonts. Für DSGVO-konforme Nutzung Schriften lokal einbinden." : undefined,
          source: ref,
        },
      },
    });
  }

  // Logo: erster brauchbarer Kandidat
  for (const cand of findLogoCandidates(html, home.url)) {
    try {
      if (cand.kind === "inline-svg" && cand.svg) {
        items.push({ field: "logoSvg", sourceKind: "website", sourceUrl: ref, confidence: 0.7, value: { svg: sanitizeSvg(cand.svg), why: cand.why } });
        break;
      }
      if (cand.src) {
        const img = await fetchRaw(cand.src, { maxBytes: 2 * 1024 * 1024, accept: "image/svg+xml,image/png,image/jpeg;q=0.9" });
        const name = (new URL(img.url).pathname.split("/").pop() || "logo").slice(0, 80);
        const type = detectFileType(/\.(svg|png|jpe?g)$/i.test(name) ? name : `${name}.${/svg/.test(img.contentType) ? "svg" : /png/.test(img.contentType) ? "png" : "jpg"}`, img.body);
        if (type === "svg") {
          items.push({ field: "logoSvg", sourceKind: "website", sourceUrl: img.url, confidence: cand.kind === "img" ? 0.75 : 0.4, value: { svg: sanitizeSvg(img.body.toString("utf8")), why: cand.why } });
        } else {
          const { file } = await storeFile({ workspaceId, kind: "logo", name: `logo-website.${type === "png" ? "png" : "jpg"}`, data: img.body, createdBy });
          items.push({ field: "logoFile", sourceKind: "website", sourceUrl: img.url, confidence: cand.kind === "img" ? 0.7 : 0.4, value: { fileId: file.id, name: file.name, why: cand.why } });
        }
        break;
      }
    } catch {
      /* nächster Kandidat */
    }
  }

  // Markenstimme aus den Texten der Startseite (kurz)
  let aiError: string | undefined;
  const { title, text } = htmlToText(html);
  if (text.trim().length > 200) {
    try {
      items.push(...suggestionsFromAi(await summarizeGuide(workspaceId, [{ source: ref, text: `${title ?? ""}\n${text}`.slice(0, 6000) }], "website"), "website", ref));
    } catch (e) {
      aiError = e instanceof Error ? e.message : String(e);
    }
  }
  const created = await proposeBrand(workspaceId, items);
  return { created, url: ref, aiError, googleFonts: analysis.googleFonts };
}

export async function workspaceDomain(workspaceId: string) {
  const ws = await db.workspace.findUnique({ where: { id: workspaceId }, select: { domain: true } });
  return ws?.domain ?? null;
}
