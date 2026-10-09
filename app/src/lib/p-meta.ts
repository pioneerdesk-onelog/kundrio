import "server-only";
import type { Workspace } from "@prisma/client";
import { db } from "./db";
import { parseFields } from "./b-forms";
import { onColor } from "./p-a11y";
import { signFormTimestamp } from "./trust";
import { env } from "./env";
import type { PageMeta } from "@/components/blocks/types";

/** Logo nie inline rendern: als Data-URL in <img> kann ein SVG kein Skript ausführen. */
function logoDataUrl(svg: string | null): string | null {
  if (!svg || !svg.trim().startsWith("<")) return null;
  return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
}

export async function loadForms(workspaceId: string) {
  const forms = await db.form.findMany({ where: { workspaceId }, orderBy: { createdAt: "desc" } });
  const map: PageMeta["forms"] = {};
  for (const f of forms) map[f.id] = {
    name: f.name,
    fields: parseFields(f.fields),
    consentText: f.consentText,
    // signierter Ausfüllbeginn für die Lead-Echtheitsprüfung (wie auf /f/[id])
    ts: signFormTimestamp(env.appSecret(), f.id),
  };
  return map;
}

export async function buildPageMeta(ws: Workspace, page: { lang: string; aiGenerated: boolean }): Promise<PageMeta> {
  return {
    brand: {
      name: ws.name,
      primary: ws.brandPrimary,
      accent: ws.brandAccent,
      onPrimary: onColor(ws.brandPrimary),
      onAccent: onColor(ws.brandAccent),
      fontHeading: ws.fontHeading,
      fontBody: ws.fontBody,
      logoDataUrl: logoDataUrl(ws.logoSvg),
    },
    forms: await loadForms(ws.id),
    imprint: ws.imprint,
    legalName: ws.legalName,
    aiGenerated: page.aiGenerated,
    lang: page.lang,
  };
}

export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/;
export const LANG_RE = /^[a-z]{2}$/;

export const LANG_NAMES: Record<string, string> = {
  de: "Deutsch", en: "Englisch", fr: "Französisch", it: "Italienisch", es: "Spanisch", pl: "Polnisch",
  uk: "Ukrainisch", tr: "Türkisch", ar: "Arabisch", ro: "Rumänisch", nl: "Niederländisch", cs: "Tschechisch",
};

export function slugify(s: string) {
  return s
    .toLowerCase()
    .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "seite";
}

/** Öffentliche URL (Pfad) einer Seite. */
export const publicPath = (wsSlug: string, lang: string, slug: string) => `/p/${wsSlug}/${lang}/${slug}`;

/** Leere Startseite mit Hero und Fuß. */
export function starterData(title: string) {
  return {
    root: { props: { title } },
    content: [
      { type: "Hero", props: { id: `Hero-${crypto.randomUUID()}`, eyebrow: "", heading: title, text: "", buttonLabel: "", buttonHref: "", secondaryLabel: "", secondaryHref: "", align: "left", showLogo: "yes", animation: "subtle" } },
      { type: "Footer", props: { id: `Footer-${crypto.randomUUID()}`, note: "" } },
    ],
  };
}
