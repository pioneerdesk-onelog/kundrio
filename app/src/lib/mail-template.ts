// Platzhalter im Brevo-Stil – bewusst KEINE Template-Sprache, nur Werte-Ersetzung:
//   {{ params.name }}  {{params.order.id}}  {{ contact.FIRSTNAME }}  {{ params.x | default: "Gast" }}
// Unbekannte Platzhalter werden leer. Im HTML wird jeder Wert HTML-escaped.

export type TemplateContext = { params?: Record<string, unknown>; contact?: Record<string, unknown> };

const PLACEHOLDER = /\{\{\s*(params|contact)((?:\.[A-Za-z0-9_-]+)+)\s*(?:\|\s*default\s*:\s*(?:"([^"]*)"|'([^']*)'))?\s*\}\}/g;

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function lookup(root: Record<string, unknown> | undefined, path: string[]): unknown {
  let cur: unknown = root;
  for (const key of path) {
    if (cur === null || typeof cur !== "object" || Array.isArray(cur)) return undefined;
    // Nur eigene Eigenschaften, kein Zugriff auf Prototypen
    if (!Object.prototype.hasOwnProperty.call(cur, key)) return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

function stringify(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return ""; // Objekte/Arrays werden nicht ausgegeben
}

/** Ersetzt Platzhalter. `html: true` escaped jeden eingesetzten Wert. */
export function renderTemplate(input: string, ctx: TemplateContext, opts: { html: boolean }): string {
  return input.replace(PLACEHOLDER, (_m, root: string, dotted: string, defDq?: string, defSq?: string) => {
    const path = dotted.slice(1).split(".");
    const value = stringify(lookup(root === "params" ? ctx.params : ctx.contact, path));
    const out = value !== "" ? value : (defDq ?? defSq ?? "");
    return opts.html ? escapeHtml(out) : out;
  });
}

/** Einfacher Text-Fallback aus HTML (für multipart/alternative). */
export function htmlToPlainText(html: string): string {
  return html
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li|tr|table)>/gi, "\n")
    .replace(/<a\s[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, text: string) => `${text.replace(/<[^>]+>/g, "")} (${href})`)
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
