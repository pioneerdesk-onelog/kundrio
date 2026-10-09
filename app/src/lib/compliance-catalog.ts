// Pflichten-Katalog. Stand der Hinweise: 10/2026 – Fristen und Pflichten vor Umsetzung prüfen
// (Skill „fakten-pruefen“). Keine Rechtsberatung.

export type Framework = "BFSG" | "AI_ACT" | "CRA" | "NIS2" | "E_RECHNUNG" | "MAIL_AUTH" | "DSGVO" | "SOUVERAENITAET";

export const FRAMEWORK_LABEL: Record<Framework, string> = {
  BFSG: "Barrierefreiheit (BFSG/EAA)",
  AI_ACT: "KI-Transparenz (EU AI Act)",
  CRA: "Cyber Resilience Act (Softwareprodukte)",
  NIS2: "NIS2 (Cybersicherheit)",
  E_RECHNUNG: "E-Rechnung (B2B)",
  MAIL_AUTH: "E-Mail-Authentifizierung",
  DSGVO: "Datenschutz (DSGVO)",
  SOUVERAENITAET: "Souveränität & Exit-Fähigkeit",
};

export type CatalogItem = { framework: Framework; key: string; title: string; description: string; auto?: boolean };

const STAND = "Laut Stand 10/2026, vor Umsetzung prüfen.";

export const CATALOG: CatalogItem[] = [
  // Barrierefreiheit
  { framework: "BFSG", key: "pages-wcag", auto: true, title: "Landingpages ohne Barrierefreiheits-Fehler", description: `Veröffentlichte Seiten bestehen die eingebaute Prüfung (Alternativtexte, Überschriften, Kontrast, Beschriftungen). Für Angebote an Verbraucher gilt das BFSG seit 28.06.2025. ${STAND}` },
  { framework: "BFSG", key: "statement", title: "Erklärung zur Barrierefreiheit veröffentlicht", description: "Beschreibung, wie die Dienstleistung die Anforderungen erfüllt, inkl. Kontaktmöglichkeit." },
  { framework: "BFSG", key: "forms", title: "Formulare per Tastatur und Screenreader bedienbar", description: "Manuelle Stichprobe mit Tastatur und Screenreader (VoiceOver/NVDA)." },
  // AI Act
  { framework: "AI_ACT", key: "chatbot-disclosure", title: "KI-Chat/Agent-API als KI erkennbar", description: `Menschen müssen erkennen können, dass sie mit einer KI interagieren. ${STAND}` },
  { framework: "AI_ACT", key: "generated-content", auto: true, title: "KI-erzeugte Seiten gekennzeichnet", description: "Seiten mit KI-Inhalten (aiGenerated) tragen einen sichtbaren Hinweis." },
  { framework: "AI_ACT", key: "usage-log", auto: true, title: "KI-Nutzung protokolliert", description: "Zweck, Modell und Zeitpunkt jedes KI-Aufrufs werden protokolliert (ohne Inhalte)." },
  { framework: "AI_ACT", key: "ai-literacy", title: "KI-Kompetenz der Mitarbeitenden", description: `Wer KI-Systeme im Unternehmen nutzt, braucht ausreichende KI-Kompetenz (Schulungsnachweis). ${STAND}` },
  // CRA
  { framework: "CRA", key: "sbom", title: "Software-Stückliste (SBOM) je Produkt", description: `Für Produkte mit digitalen Elementen (z. B. OneLog, Suveri): SBOM erzeugen und aktuell halten. ${STAND}` },
  { framework: "CRA", key: "vuln-process", title: "Schwachstellen-Prozess und Meldeweg", description: "Kontaktadresse (security.txt), Bearbeitungsprozess, Meldung aktiv ausgenutzter Schwachstellen." },
  { framework: "CRA", key: "support-period", title: "Supportzeitraum festgelegt und kommuniziert", description: "Wie lange es Sicherheitsupdates gibt." },
  // NIS2
  { framework: "NIS2", key: "applicability", title: "Betroffenheit geprüft", description: `Prüfen, ob das Unternehmen bzw. der Kunde unter NIS2/NIS2UmsuCG fällt (Sektor, Größe). ${STAND}` },
  { framework: "NIS2", key: "risk-measures", title: "Risikomanagement-Maßnahmen dokumentiert", description: "Backups, Zugriffskontrolle, MFA, Patch-Management, Lieferkette." },
  { framework: "NIS2", key: "incident-reporting", title: "Meldeprozess für Sicherheitsvorfälle", description: "Wer meldet was, wann, an wen." },
  // E-Rechnung
  { framework: "E_RECHNUNG", key: "receive", title: "E-Rechnungen empfangen können", description: `Empfang strukturierter E-Rechnungen (XRechnung/ZUGFeRD) im B2B. ${STAND}` },
  { framework: "E_RECHNUNG", key: "send", auto: true, title: "E-Rechnungen versenden können", description: `XRechnung-Export im CRM; Firmendaten vollständig. Versandpflicht stufenweise 2027/2028. ${STAND}` },
  // Mail-Auth
  { framework: "MAIL_AUTH", key: "spf", auto: true, title: "SPF-Eintrag vorhanden", description: "TXT-Eintrag v=spf1 an der Absender-Domain." },
  { framework: "MAIL_AUTH", key: "dkim", auto: true, title: "DKIM-Schlüssel vorhanden", description: "DKIM-Selektor des Versanddienstes ist im DNS veröffentlicht." },
  { framework: "MAIL_AUTH", key: "dmarc", auto: true, title: "DMARC-Richtlinie vorhanden", description: "TXT-Eintrag unter _dmarc.<domain>, mindestens p=none, Ziel p=quarantine/reject." },
  { framework: "MAIL_AUTH", key: "one-click", title: "Abmeldung per One-Click", description: "List-Unsubscribe und List-Unsubscribe-Post in Kampagnen (im CRM umgesetzt)." },
  // DSGVO
  { framework: "DSGVO", key: "export", auto: true, title: "Datenexport möglich (Art. 20)", description: "Vollständiger Export des Sub-Accounts als ZIP." },
  { framework: "DSGVO", key: "retention", auto: true, title: "Löschfristen automatisiert", description: "Analytics-Rohdaten werden regelmäßig gelöscht (Job analytics.retention)." },
  { framework: "DSGVO", key: "avv", title: "Auftragsverarbeitungsverträge", description: "AVV mit allen Dienstleistern (Hosting, SMTP-Relay)." },
  { framework: "DSGVO", key: "vvt", title: "Verzeichnis der Verarbeitungstätigkeiten", description: "CRM, Formulare, Newsletter, Analytics, KI eintragen." },
  { framework: "DSGVO", key: "doi", title: "Double-Opt-in-Nachweise", description: "Einwilligungen mit Zeitpunkt und Quelle gespeichert (im CRM umgesetzt)." },
  // Souveränität
  { framework: "SOUVERAENITAET", key: "region", auto: true, title: "Keine Datenflüsse außerhalb der Region", description: "Aktive Außenverbindungen passen zur Region des Sub-Accounts (DE/EU)." },
  { framework: "SOUVERAENITAET", key: "exit-test", title: "Exit-Test durchgeführt", description: "Export geprüft und in einer zweiten Umgebung eingespielt; jeder externe Dienst hat einen Ersatz." },
];
