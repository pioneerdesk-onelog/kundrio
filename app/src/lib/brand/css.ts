// Website-CI aus HTML/CSS ableiten: Farben (Variablen + Häufigkeit), Schriften, Google-Fonts, Logo-Kandidaten.
// Rein (ohne Netz) – der Abruf passiert in website.ts.

import { hsl, isNeutral, normalizeHex, toHex } from "./colors";

export type CssAnalysis = {
  variables: { name: string; value: string; hex: string | null }[];
  colors: { hex: string; count: number }[];
  fonts: string[];
  googleFonts: string[];
};

// Emoji-, Symbol- und System-Monospace-Schriften sind Fallbacks, keine Markenschriften
const FALLBACK_FONTS = /^(apple color emoji|segoe ui emoji|segoe ui symbol|noto color emoji|android emoji|emojione color|twemoji mozilla|sfmono-regular|sf mono|menlo|monaco|consolas|courier new|courier|liberation mono|dejavu sans mono|lucida console|blinkmacsystemfont|-apple-system|segoe ui|roboto|helvetica neue|arial|noto sans|liberation sans|ubuntu|cantarell|oxygen|fira sans|droid sans|helvetica|sans|times new roman|times)$/i;

/** Kommagetrennte Liste aufteilen, Kommas in Klammern (var(--x, a, b)) und Anführungszeichen beachten. */
export function splitTopLevel(list: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let cur = "";
  for (const ch of list) {
    if (quote) {
      if (ch === quote) quote = null;
      cur += ch;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "(") depth++;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    else if (ch === "," && depth === 0) {
      out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** Next.js/font-Namen bereinigen: "__Inter_a1b2c3" → "Inter", "__Inter_Fallback_x" → null */
export function cleanFontName(raw: string): string | null {
  let n = raw.trim().replace(/\s*!important$/, "").replace(/["']/g, "").trim();
  if (!n) return null;
  if (/^__.+_Fallback_[0-9a-f]+$/i.test(n) || / Fallback$/i.test(n)) return null;
  const m = n.match(/^__(.+?)_[0-9a-f]{5,}$/i);
  if (m) n = m[1].replace(/_/g, " ");
  return n;
}

const GENERIC_FONTS = new Set(["serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui", "ui-sans-serif", "ui-serif", "ui-monospace", "-apple-system", "blinkmacsystemfont", "inherit", "initial", "unset", "emoji", "math"]);

function colorToHex(value: string): string | null {
  const v = value.trim();
  const h = v.match(/^#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/);
  if (h) return normalizeHex(h[1]);
  const r = v.match(/^rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})/i);
  if (r) return toHex(+r[1], +r[2], +r[3]);
  return null;
}

export function analyzeCss(css: string, html = ""): CssAnalysis {
  const variables: CssAnalysis["variables"] = [];
  for (const m of css.matchAll(/(--[\w-]{2,60})\s*:\s*([^;}{]{1,400})/g)) {
    variables.push({ name: m[1], value: m[2].trim(), hex: colorToHex(m[2]) });
  }

  const counts = new Map<string, number>();
  const bump = (hex: string | null, n = 1) => hex && counts.set(hex, (counts.get(hex) ?? 0) + n);
  for (const m of css.matchAll(/#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g)) bump(normalizeHex(m[1]));
  for (const m of css.matchAll(/rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})/gi)) bump(toHex(+m[1], +m[2], +m[3]));
  // Inline-Styles im HTML zählen mit
  for (const m of html.matchAll(/style="[^"]*?(#[0-9a-fA-F]{3,6})\b/g)) bump(normalizeHex(m[1]));

  const varMap = new Map(variables.map((v) => [v.name, v.value]));
  const fontCounts = new Map<string, number>();
  const firstFamily = (decl: string, depth = 0): string | null => {
    for (const part of splitTopLevel(decl)) {
      const p = part.trim();
      const v = p.match(/^var\(\s*(--[\w-]+)\s*(?:,\s*([\s\S]*))?\)$/);
      if (v) {
        // Schrift über CSS-Variable (z. B. Tailwind/next/font) auflösen
        const resolved = depth < 3 && varMap.get(v[1]) ? firstFamily(varMap.get(v[1])!, depth + 1) : null;
        if (resolved) return resolved;
        if (v[2]) {
          const fb = firstFamily(v[2], depth + 1);
          if (fb) return fb;
        }
        continue;
      }
      const name = cleanFontName(p);
      if (!name || GENERIC_FONTS.has(name.toLowerCase()) || FALLBACK_FONTS.test(name)) continue;
      return name;
    }
    return null;
  };
  for (const m of css.matchAll(/font-family\s*:\s*([^;}{]+)/gi)) {
    const name = firstFamily(m[1]);
    if (name) fontCounts.set(name, (fontCounts.get(name) ?? 0) + 1);
  }
  // Schrift-Variablen selbst (z. B. --font-heading) zählen, falls nirgends direkt verwendet
  for (const v of variables) {
    if (!/font/i.test(v.name) || /size|weight|feature|variation|smoothing/i.test(v.name)) continue;
    const name = firstFamily(v.value);
    if (name && !fontCounts.has(name)) fontCounts.set(name, 0.5);
  }

  const googleFonts = new Set<string>();
  for (const m of (css + html).matchAll(/fonts\.googleapis\.com\/css2?\?family=([^"')&\s]+)/g)) {
    for (const fam of decodeURIComponent(m[1]).split("|")) googleFonts.add(fam.split(":")[0].replace(/\+/g, " "));
  }

  return {
    variables: variables.slice(0, 200),
    colors: [...counts.entries()].map(([hex, count]) => ({ hex, count })).sort((a, b) => b.count - a.count),
    fonts: [...fontCounts.entries()].sort((a, b) => b[1] - a[1]).map(([f]) => f).slice(0, 6),
    googleFonts: [...googleFonts].slice(0, 6),
  };
}

const ROLE_HINTS: { role: "primary" | "accent"; re: RegExp }[] = [
  { role: "primary", re: /(primary|brand|main|haupt|prim)/i },
  { role: "accent", re: /(accent|secondary|highlight|akzent|second)/i },
];

/**
 * Primär-/Akzentfarbe vorschlagen: zuerst benannte CSS-Variablen (primary/brand, accent/secondary),
 * sonst die häufigsten nicht-neutralen Farben mit deutlich unterschiedlichem Farbton.
 */
export function pickBrandColors(a: CssAnalysis): { primary: string | null; accent: string | null; reason: { primary: string; accent: string } } {
  const fromVar = (role: "primary" | "accent") => {
    const hint = ROLE_HINTS.find((h) => h.role === role)!.re;
    const v = a.variables.find((x) => x.hex && hint.test(x.name) && !/(text|bg|background|foreground|border|hover|light|dark)/i.test(x.name) && !isNeutral(x.hex));
    return v ? { hex: v.hex!, why: `CSS-Variable ${v.name}` } : null;
  };
  // Für Vorschläge aus Häufigkeit nur „echte“ Markenfarben: nicht neutral, nicht fast schwarz/weiß (Hintergründe)
  const saturated = a.colors.filter((c) => !isNeutral(c.hex) && hsl(c.hex).l >= 0.2 && hsl(c.hex).l <= 0.85 && hsl(c.hex).s >= 0.25);
  const p = fromVar("primary") ?? (saturated[0] ? { hex: saturated[0].hex, why: `häufigste Markenfarbe im CSS (${saturated[0].count}×)` } : null);
  let acc = fromVar("accent");
  if (!acc && p) {
    const ph = hsl(p.hex).h;
    const other = saturated.find((c) => c.hex !== p.hex && Math.min(Math.abs(hsl(c.hex).h - ph), 360 - Math.abs(hsl(c.hex).h - ph)) > 25);
    if (other) acc = { hex: other.hex, why: `zweithäufigste Farbe mit anderem Farbton (${other.count}×)` };
  }
  return { primary: p?.hex ?? null, accent: acc?.hex ?? null, reason: { primary: p?.why ?? "", accent: acc?.why ?? "" } };
}

export type LogoCandidate = { kind: "inline-svg" | "img" | "og-image" | "touch-icon"; src?: string; svg?: string; why: string };

/** Logo-Kandidaten aus dem HTML, in absteigender Güte. */
export function findLogoCandidates(html: string, baseUrl: string): LogoCandidate[] {
  const out: LogoCandidate[] = [];
  const abs = (u: string) => {
    try {
      return new URL(u.replace(/&amp;/g, "&"), baseUrl).toString();
    } catch {
      return null;
    }
  };
  // Inline-SVG in einem Element mit „logo“ in class/id/aria-label
  for (const m of html.matchAll(/<(a|div|span|header|figure)[^>]*(?:class|id|aria-label)="[^"]*logo[^"]*"[^>]*>([\s\S]{0,40000}?)<\/\1>/gi)) {
    const svg = m[2].match(/<svg[\s\S]*?<\/svg>/i)?.[0];
    if (svg) out.push({ kind: "inline-svg", svg, why: "Inline-SVG im Logo-Element" });
  }
  for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
    const tag = m[0];
    if (!/logo/i.test(tag)) continue;
    const src = tag.match(/\bsrc="([^"]+)"/i)?.[1];
    const url = src && !src.startsWith("data:") ? abs(src) : null;
    if (url) out.push({ kind: "img", src: url, why: "Bild mit „logo“ in Dateiname/Alt/Klasse" });
  }
  const og = html.match(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/i)?.[1] ?? html.match(/<meta[^>]+content="([^"]+)"[^>]+property="og:image"/i)?.[1];
  if (og && abs(og)) out.push({ kind: "og-image", src: abs(og)!, why: "Vorschaubild (og:image)" });
  const touch = html.match(/<link[^>]+rel="apple-touch-icon[^"]*"[^>]+href="([^"]+)"/i)?.[1];
  if (touch && abs(touch)) out.push({ kind: "touch-icon", src: abs(touch)!, why: "App-Symbol (apple-touch-icon)" });
  return out.slice(0, 6);
}

/** Verlinkte Stylesheets (max. n). */
export function stylesheetLinks(html: string, baseUrl: string, max = 5): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = m[0];
    if (!/rel="?stylesheet/i.test(tag)) continue;
    const href = tag.match(/\bhref="([^"]+)"/i)?.[1];
    if (!href) continue;
    try {
      const u = new URL(href.replace(/&amp;/g, "&"), baseUrl);
      if (/fonts\.googleapis\.com/.test(u.host)) continue; // nur erkennen, nicht laden
      out.push(u.toString());
    } catch {
      /* ungültig */
    }
    if (out.length >= max) break;
  }
  return out;
}

export function inlineStyles(html: string) {
  return [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join("\n");
}
