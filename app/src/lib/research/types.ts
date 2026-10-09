// Gemeinsame Typen der Presse-/Erwähnungs-Recherche (rein, ohne DB).

export type SourceKind = "gdelt" | "searxng" | "website" | "rss";

/** Roh-Treffer einer Quelle – noch nicht geprüft, nicht gespeichert. */
export type RawHit = {
  url: string;
  title: string;
  snippet?: string | null;
  publishedAt?: Date | null;
  sourceHost?: string | null;
  sourceKind: SourceKind;
  language?: string | null;
};

/** Wonach gesucht wird: Unternehmen oder (nur beruflich) Kontakt. */
export type ResearchEntity = {
  kind: "company" | "contact";
  /** Unternehmensname bzw. Firmenname des Kontakts */
  companyName: string | null;
  /** Primäre Domain des Unternehmens (ohne www) – eigene Seiten werden nicht als Erwähnung gezählt */
  domain: string | null;
  /** Nur bei Kontakten: Vor- und Nachname */
  personName?: string | null;
  city?: string | null;
  industry?: string | null;
};

export const TOPICS = [
  "Finanzierung",
  "Personalie",
  "Produkt",
  "Auftrag",
  "Partnerschaft",
  "Rechtsstreit",
  "Insolvenz",
  "Auszeichnung",
  "Veranstaltung",
  "Expansion",
  "Sonstiges",
] as const;
export type Topic = (typeof TOPICS)[number];

/** Themen, bei denen Zuständige eine Prüfaufgabe bekommen. */
export const ALERT_TOPICS: Topic[] = ["Insolvenz", "Rechtsstreit", "Personalie", "Finanzierung"];

export const SNIPPET_MAX = 300;
