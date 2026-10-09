// Gemeinsame Typen für Editor und öffentliche Darstellung.
export type Animation = "none" | "subtle" | "expressive";

/** Wird als Puck-`metadata` an Editor und Render übergeben. */
export type PageMeta = {
  brand: {
    name: string;
    primary: string;
    accent: string;
    onPrimary: string;
    onAccent: string;
    fontHeading: string;
    fontBody: string;
    /** Data-URL des Logos (SVG als <img>, nie inline → kein Skript möglich) */
    logoDataUrl: string | null;
  };
  forms: Record<string, { name: string; fields: { key: string; label: string; type: "text" | "email" | "tel" | "textarea"; required: boolean }[]; consentText: string | null; ts?: string }>;
  imprint: string | null;
  legalName: string | null;
  aiGenerated: boolean;
  lang: string;
};

export const FONT_STACKS: Record<string, string> = {
  Newsreader: '"Newsreader Variable", "Iowan Old Style", Georgia, serif',
  Inter: '"Inter Variable", ui-sans-serif, system-ui, sans-serif',
  "JetBrains Mono": '"JetBrains Mono Variable", ui-monospace, monospace',
  System: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
  Serif: 'Georgia, "Times New Roman", serif',
};

export const fontStack = (name: string) => FONT_STACKS[name] ?? FONT_STACKS.System;
