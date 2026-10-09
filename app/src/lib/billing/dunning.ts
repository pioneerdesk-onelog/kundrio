// Mahnwesen (reine Logik): Stufen 1 Zahlungserinnerung, 2 Mahnung, 3 letzte Mahnung.
import { addDays, dateOnly } from "./periods";

export type DunningSettings = {
  enabled: boolean;
  /** Tage nach Fälligkeit bis Stufe 1, dann jeweils Abstand zur vorherigen Stufe */
  daysToLevel1: number;
  daysToLevel2: number;
  daysToLevel3: number;
  /** Mahngebühr je Stufe in Cent (nur als Hinweis im Text – Belege nach Versand unveränderlich) */
  feeCents: [number, number, number];
  texts: Record<"1" | "2" | "3", { subject: string; body: string }>;
};

export const DUNNING_LABEL: Record<number, string> = { 0: "–", 1: "Zahlungserinnerung", 2: "Mahnung", 3: "Letzte Mahnung" };

export const DEFAULT_DUNNING: DunningSettings = {
  enabled: true,
  daysToLevel1: 7,
  daysToLevel2: 14,
  daysToLevel3: 14,
  feeCents: [0, 500, 1000],
  texts: {
    "1": {
      subject: "Zahlungserinnerung zu Rechnung {{ dokument.nummer }}",
      body: "Guten Tag {{ kunde.ansprechpartner | default: \"zusammen\" }},\n\nsicher ist es Ihnen im Alltag entgangen: Die Rechnung {{ dokument.nummer }} über {{ dokument.summe_brutto }} war am {{ dokument.faellig_am }} fällig. Bitte überweisen Sie den Betrag in den nächsten Tagen. Falls Sie bereits gezahlt haben, betrachten Sie diese Nachricht bitte als gegenstandslos.{{ dokument.zahlungslink_text }}\n\nFreundliche Grüße\n{{ absender.firma }}",
    },
    "2": {
      subject: "Mahnung zu Rechnung {{ dokument.nummer }}",
      body: "Guten Tag {{ kunde.ansprechpartner | default: \"zusammen\" }},\n\nleider konnten wir für die Rechnung {{ dokument.nummer }} über {{ dokument.summe_brutto }} (fällig am {{ dokument.faellig_am }}) noch keinen Zahlungseingang feststellen. Bitte begleichen Sie den offenen Betrag{{ mahnung.gebuehr_text }} innerhalb von 7 Tagen.{{ dokument.zahlungslink_text }}\n\nFreundliche Grüße\n{{ absender.firma }}",
    },
    "3": {
      subject: "Letzte Mahnung zu Rechnung {{ dokument.nummer }}",
      body: "Guten Tag {{ kunde.ansprechpartner | default: \"zusammen\" }},\n\ntrotz Erinnerung und Mahnung ist die Rechnung {{ dokument.nummer }} über {{ dokument.summe_brutto }} weiterhin offen. Bitte zahlen Sie den Betrag{{ mahnung.gebuehr_text }} innerhalb von 7 Tagen. Andernfalls müssen wir weitere Schritte einleiten.{{ dokument.zahlungslink_text }}\n\nFreundliche Grüße\n{{ absender.firma }}",
    },
  },
};

export function parseDunningSettings(v: unknown): DunningSettings {
  const o = (v && typeof v === "object" ? v : {}) as Partial<DunningSettings>;
  const n = (x: unknown, d: number) => (typeof x === "number" && Number.isFinite(x) && x >= 0 && x <= 365 ? Math.round(x) : d);
  const fees = Array.isArray(o.feeCents) && o.feeCents.length === 3 ? (o.feeCents.map((f, i) => (typeof f === "number" && f >= 0 && f <= 100000 ? Math.round(f) : DEFAULT_DUNNING.feeCents[i])) as [number, number, number]) : DEFAULT_DUNNING.feeCents;
  const texts = { ...DEFAULT_DUNNING.texts };
  for (const k of ["1", "2", "3"] as const) {
    const t = (o.texts as DunningSettings["texts"] | undefined)?.[k];
    if (t && typeof t.subject === "string" && typeof t.body === "string" && t.subject.trim() && t.body.trim()) texts[k] = { subject: t.subject.slice(0, 300), body: t.body.slice(0, 8000) };
  }
  return {
    enabled: typeof o.enabled === "boolean" ? o.enabled : true,
    daysToLevel1: n(o.daysToLevel1, DEFAULT_DUNNING.daysToLevel1),
    daysToLevel2: n(o.daysToLevel2, DEFAULT_DUNNING.daysToLevel2),
    daysToLevel3: n(o.daysToLevel3, DEFAULT_DUNNING.daysToLevel3),
    feeCents: fees,
    texts,
  };
}

/**
 * Nächste fällige Mahnstufe oder null.
 * Stufe 1: dueDate + daysToLevel1; Stufe 2: dunnedAt(1) + daysToLevel2; Stufe 3: dunnedAt(2) + daysToLevel3.
 */
export function nextDunningLevel(input: { dueDate: Date | null; level: number; dunnedAt: Date | null; today: Date; inCollection: boolean }, s: DunningSettings): number | null {
  if (!s.enabled || !input.dueDate || input.inCollection || input.level >= 3) return null;
  const today = dateOnly(input.today);
  if (input.level === 0) return addDays(input.dueDate, s.daysToLevel1) <= today ? 1 : null;
  if (!input.dunnedAt) return null;
  const gap = input.level === 1 ? s.daysToLevel2 : s.daysToLevel3;
  return addDays(input.dunnedAt, gap) <= today ? input.level + 1 : null;
}

/** Mahnungs-Platzhalter ({{ mahnung.stufe }}, {{ mahnung.gebuehr }}, {{ mahnung.gebuehr_text }}) vor den Belegplatzhaltern ersetzen. */
export function renderDunningPlaceholders(text: string, level: number, feeCents: number): string {
  const fee = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(feeCents / 100);
  const values: Record<string, string> = {
    stufe: DUNNING_LABEL[level] ?? "",
    gebuehr: feeCents > 0 ? fee : "",
    gebuehr_text: feeCents > 0 ? ` zuzüglich einer Mahngebühr von ${fee}` : "",
  };
  return text.replace(/\{\{\s*mahnung\.([a-z_]+)\s*\}\}/g, (_m, k: string) => values[k] ?? "");
}
