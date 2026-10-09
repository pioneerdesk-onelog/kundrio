// Farb- und Schrifterkennung in Texten (Brandbook) – deterministisch, ohne KI.

export type FoundColor = {
  hex: string; // #rrggbb (klein)
  kind: "hex" | "rgb" | "cmyk";
  raw: string;
  /** CMYK → RGB ist nur eine Näherung (ohne Farbprofil) */
  approx?: boolean;
  /** Text vor der Farbangabe, z. B. „Primärfarbe Petrol“ */
  label?: string;
  count: number;
};

const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
export const toHex = (r: number, g: number, b: number) => `#${[r, g, b].map((v) => clamp(v).toString(16).padStart(2, "0")).join("")}`;

export function normalizeHex(h: string): string | null {
  const m = h.trim().replace(/^#/, "").toLowerCase();
  if (/^[0-9a-f]{6}$/.test(m)) return `#${m}`;
  if (/^[0-9a-f]{3}$/.test(m)) return `#${m.split("").map((c) => c + c).join("")}`;
  return null;
}

/** Näherung CMYK (0–100) → sRGB, ohne ICC-Profil. */
export function cmykToHex(c: number, m: number, y: number, k: number) {
  const f = (x: number) => Math.max(0, Math.min(100, x)) / 100;
  const K = f(k);
  return toHex(255 * (1 - f(c)) * (1 - K), 255 * (1 - f(m)) * (1 - K), 255 * (1 - f(y)) * (1 - K));
}

export function hexToRgb(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

/** Sättigung/Helligkeit (HSL), um Grau/Weiß/Schwarz von Markenfarben zu unterscheiden. */
export function hsl(hex: string) {
  const { r, g, b } = hexToRgb(hex);
  const [R, G, B] = [r / 255, g / 255, b / 255];
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const l = (max + min) / 2;
  const d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (d !== 0) {
    if (max === R) h = 60 * (((G - B) / d) % 6);
    else if (max === G) h = 60 * ((B - R) / d + 2);
    else h = 60 * ((R - G) / d + 4);
  }
  return { h: (h + 360) % 360, s, l };
}

export const isNeutral = (hex: string) => {
  const { s, l } = hsl(hex);
  return s < 0.12 || l < 0.08 || l > 0.95;
};

function labelBefore(text: string, index: number) {
  const before = text.slice(Math.max(0, index - 60), index);
  const line = before.split(/\n/).pop() ?? "";
  const clean = line.replace(/[#:=–—|•·\-]+\s*$/, "").replace(/\b(HEX|RGB|CMYK|RAL|HKS)\b.*$/i, "").trim();
  return clean.length >= 2 ? clean.slice(-40) : undefined;
}

/** Findet Farbangaben (HEX, rgb(), „RGB 11 79 108“, „CMYK 90 30 10 40“) und zählt Häufigkeiten. */
export function findColors(text: string): FoundColor[] {
  const found = new Map<string, FoundColor>();
  const add = (hex: string | null, kind: FoundColor["kind"], raw: string, index: number, approx = false) => {
    if (!hex) return;
    const prev = found.get(hex);
    if (prev) {
      prev.count++;
      prev.label ??= labelBefore(text, index);
      return;
    }
    found.set(hex, { hex, kind, raw, approx: approx || undefined, label: labelBefore(text, index), count: 1 });
  };

  for (const m of text.matchAll(/#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g)) add(normalizeHex(m[1]), "hex", m[0], m.index ?? 0);
  // „HEX 0B4F6C“ ohne Raute
  for (const m of text.matchAll(/\bHEX\s*[:=]?\s*([0-9a-fA-F]{6})\b/gi)) add(normalizeHex(m[1]), "hex", m[0], m.index ?? 0);
  for (const m of text.matchAll(/\brgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/gi)) add(toHex(+m[1], +m[2], +m[3]), "rgb", m[0], m.index ?? 0);
  for (const m of text.matchAll(/\bRGB\s*[:=]?\s*(\d{1,3})[\s/,]+(\d{1,3})[\s/,]+(\d{1,3})\b/gi)) {
    if ([m[1], m[2], m[3]].every((v) => +v <= 255)) add(toHex(+m[1], +m[2], +m[3]), "rgb", m[0], m.index ?? 0);
  }
  for (const m of text.matchAll(/\bCMYK\s*[:=]?\s*(\d{1,3})\s*%?[\s/,]+(\d{1,3})\s*%?[\s/,]+(\d{1,3})\s*%?[\s/,]+(\d{1,3})\s*%?/gi)) {
    if ([m[1], m[2], m[3], m[4]].every((v) => +v <= 100)) add(cmykToHex(+m[1], +m[2], +m[3], +m[4]), "cmyk", m[0], m.index ?? 0, true);
  }
  return [...found.values()].sort((a, b) => b.count - a.count);
}

/** Pantone-/HKS-/RAL-Angaben nur als Text (keine verlässliche Umrechnung). */
export function findSpotColors(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/\b(Pantone|PMS|HKS|RAL)\s*[A-Z]?\s*\d{1,4}(?:\s?[A-Z]{1,2})?\b/gi)) out.add(m[0].replace(/\s+/g, " ").trim());
  return [...out].slice(0, 20);
}

const KNOWN_FONTS = [
  "Inter", "Roboto", "Open Sans", "Lato", "Montserrat", "Source Sans", "Source Serif", "Noto Sans", "Noto Serif", "Merriweather",
  "Playfair Display", "Poppins", "Raleway", "Nunito", "Work Sans", "IBM Plex Sans", "IBM Plex Serif", "Newsreader", "Helvetica",
  "Helvetica Neue", "Arial", "Frutiger", "Univers", "Futura", "Gill Sans", "DIN", "DIN Next", "FF DIN", "Avenir", "Avenir Next",
  "Myriad", "Garamond", "EB Garamond", "Georgia", "Times New Roman", "Calibri", "Segoe UI", "Verdana", "Fira Sans", "PT Sans",
  "PT Serif", "Rubik", "Manrope", "DM Sans", "DM Serif", "Barlow", "Libre Baskerville", "Baskerville", "JetBrains Mono", "Space Grotesk",
];

/** Schriftnamen im Text (bekannte Schriften + „Schrift/Font/Hausschrift: X“). */
export function findFonts(text: string): string[] {
  const out = new Map<string, number>();
  const bump = (f: string) => out.set(f, (out.get(f) ?? 0) + 1);
  for (const f of KNOWN_FONTS) {
    const re = new RegExp(`\\b${f.replace(/ /g, "\\s+")}\\b`, "gi");
    const n = text.match(re)?.length ?? 0;
    for (let i = 0; i < n; i++) bump(f);
  }
  for (const m of text.matchAll(/\b(?:Hausschrift|Schriftart|Schrift|Font|Typeface|Typografie)\s*[:=–-]\s*([A-ZÄÖÜ][\w\- ]{2,30}?)(?=[,.;\n]|$)/g)) {
    const name = m[1].trim();
    if (!/^(die|der|das|eine?|ist|wird)\b/i.test(name)) bump(name);
  }
  return [...out.entries()].sort((a, b) => b[1] - a[1]).map(([f]) => f).slice(0, 8);
}
