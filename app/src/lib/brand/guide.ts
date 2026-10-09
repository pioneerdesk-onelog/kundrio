import { z } from "zod";

// Aufbau des Markenleitfadens (Workspace.brandGuide) und KI-Ausgabeformat. Rein – auch im Client nutzbar.

const sourced = z.object({ text: z.string().trim().min(1).max(400), source: z.string().max(200) });
export type Sourced = z.infer<typeof sourced>;

export const COLOR_ROLES = ["primary", "accent", "secondary", "neutral", "other"] as const;
export const COLOR_ROLE_LABELS: Record<(typeof COLOR_ROLES)[number], string> = {
  primary: "Primär",
  accent: "Akzent",
  secondary: "Sekundär",
  neutral: "Neutral",
  other: "Weitere",
};

export const guideColorSchema = z.object({
  name: z.string().trim().max(60).default(""),
  hex: z.string().regex(/^#[0-9a-f]{6}$/i),
  role: z.enum(COLOR_ROLES).default("other"),
  source: z.string().max(200).optional(),
  approx: z.boolean().optional(),
});

export const brandGuideSchema = z.object({
  voice: z.object({ summary: z.string().max(1200), adjectives: z.array(z.string().max(40)).max(10).default([]), sources: z.array(z.string().max(200)).max(10).default([]) }).optional(),
  doAndDont: z.object({ do: z.array(sourced).max(20).default([]), dont: z.array(sourced).max(20).default([]) }).optional(),
  audience: z.array(sourced).max(10).optional(),
  writingRules: z
    .object({
      address: z.enum(["du", "sie", "unklar"]).default("unklar"),
      gender: z.string().max(200).optional(),
      terms: z.array(z.string().max(80)).max(30).default([]),
      notes: z.array(sourced).max(15).default([]),
    })
    .optional(),
  colors: z.array(guideColorSchema).max(24).optional(),
  typography: z
    .object({
      heading: z.string().max(80).optional(),
      body: z.string().max(80).optional(),
      others: z.array(z.string().max(80)).max(8).default([]),
      googleFonts: z.array(z.string().max(80)).max(8).default([]),
      notes: z.string().max(600).optional(),
      source: z.string().max(200).optional(),
    })
    .optional(),
  logoRules: z.array(sourced).max(15).optional(),
  logoFileId: z.string().max(40).optional(),
  spotColors: z.array(z.string().max(40)).max(20).optional(),
  sources: z.array(z.object({ kind: z.enum(["brandbook", "website", "manual"]), ref: z.string().max(300), at: z.string().max(40) })).max(50).optional(),
});
export type BrandGuide = z.infer<typeof brandGuideSchema>;

export function parseGuide(value: unknown): BrandGuide {
  const r = brandGuideSchema.safeParse(value ?? {});
  return r.success ? r.data : {};
}

/** Ausgabe der KI-Zusammenfassung (strenges JSON). */
export const aiGuideSchema = z.object({
  voice: z.object({ summary: z.string().max(1200), adjectives: z.array(z.string().max(40)).max(10), sources: z.array(z.string().max(200)).max(10) }).nullable(),
  do: z.array(sourced).max(15),
  dont: z.array(sourced).max(15),
  audience: z.array(sourced).max(8),
  writingRules: z.object({ address: z.enum(["du", "sie", "unklar"]), gender: z.string().max(200).nullable(), terms: z.array(z.string().max(80)).max(20), notes: z.array(sourced).max(10) }),
  logoRules: z.array(sourced).max(10),
});
export type AiGuide = z.infer<typeof aiGuideSchema>;

/** Felder, die als Vorschlag übernommen werden können. */
export const SUGGESTION_FIELDS = {
  brandPrimary: "Primärfarbe",
  brandAccent: "Akzentfarbe",
  fontHeading: "Schrift Überschriften",
  fontBody: "Schrift Fließtext",
  logoSvg: "Logo (SVG)",
  logoFile: "Logo (Bild)",
  "guide.colors": "Farbpalette",
  "guide.voice": "Markenstimme",
  "guide.doAndDont": "Do's & Don'ts",
  "guide.audience": "Zielgruppe",
  "guide.writingRules": "Schreibregeln",
  "guide.typography": "Typografie",
  "guide.logoRules": "Logo-Regeln",
  "guide.spotColors": "Sonderfarben (Pantone/HKS/RAL)",
} as const;
export type SuggestionField = keyof typeof SUGGESTION_FIELDS;

/** In der App verfügbare Schriften (lokal eingebunden). Andere Schriften landen nur im Leitfaden. */
export const APP_FONTS = ["Newsreader", "Inter", "System"] as const;

export function matchAppFont(name: string | undefined): (typeof APP_FONTS)[number] | null {
  if (!name) return null;
  const n = name.toLowerCase();
  if (n.includes("newsreader")) return "Newsreader";
  if (n === "inter" || n.startsWith("inter ")) return "Inter";
  return null;
}
