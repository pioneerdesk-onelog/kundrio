// Einstellungen der Anreicherung (öffentliche Daten aus Website/Impressum und eigener Suchmaschine).
// Quellen-Entscheidung 07.10.2026: souverän + offen (keine Daten-Broker), Personen nur beruflich.

export const enrichConfig = {
  /** Eigene SearXNG-Instanz (JSON-API). Leer = keine Websuche. */
  searxUrl: () => (process.env.SEARXNG_URL ?? "").replace(/\/+$/, ""),
  /** Bevorzugte Suchdienste in SearXNG (kommagetrennt), EU-nahe zuerst. */
  searxEngines: () => process.env.SEARXNG_ENGINES ?? "mojeek,startpage,duckduckgo",
  userAgent: () => `Kundrio-Enrichment/1.0 (+${process.env.APP_URL ?? "http://127.0.0.1:3100"})`,
  /** Nur Entwicklung/Tests: Abruf privater Adressen (Mock-Server) erlauben. */
  allowPrivate: () => process.env.ENRICH_ALLOW_PRIVATE === "true" && process.env.NODE_ENV !== "production",
  maxPages: 8,
  pageTimeoutMs: 12_000,
  /** Mindestabstand zwischen zwei Abrufen derselben Domain */
  perHostDelayMs: 1_000,
  maxBytes: 2 * 1024 * 1024,
};

/** Tag, mit dem ein Kontakt der Anreicherung widerspricht. */
export const OPT_OUT_TAG = "keine-anreicherung";
