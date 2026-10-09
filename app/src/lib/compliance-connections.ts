// Alle Außenverbindungen, die das System aufbauen kann – Grundlage für Souveränitäts-Cockpit und Regionsprüfung.

export type Connection = {
  id: string;
  name: string;
  provider: string;
  location: string;
  regions: ("DE" | "EU")[]; // Regionen, mit denen die Verbindung verträglich ist
  outbound: boolean;
  active: boolean;
  note: string;
  replaceable: string; // Ersatz bei Ausfall/Exit
  /** Nur genutzt, wenn der Sub-Account die Funktion einschaltet (sonst fließt nichts ab) */
  onlyWhen?: "mentionMonitoring";
};

type WsRegion = { region: string; mentionMonitoring?: boolean | null };

/** Verbindung wird im Sub-Account tatsächlich genutzt (aktiv, nach außen, ggf. Funktion eingeschaltet). */
export function usedIn(c: Connection, ws: WsRegion) {
  if (!c.active || !c.outbound) return false;
  if (c.onlyWhen === "mentionMonitoring") return !!ws.mentionMonitoring;
  return true;
}

/** Echte Regionsverstöße: genutzte Verbindungen außerhalb der Region des Sub-Accounts. */
export function regionViolations(conns: Connection[], ws: WsRegion) {
  return conns.filter((c) => usedIn(c, ws) && !c.regions.includes(ws.region as "DE" | "EU"));
}

function isLocalHost(url: string | undefined) {
  if (!url) return true;
  try {
    const h = new URL(url).hostname;
    return h === "localhost" || h === "127.0.0.1" || h === "::1" || h.endsWith(".local") || h.endsWith(".internal");
  } catch {
    return false;
  }
}

export function externalConnections(env: Record<string, string | undefined> = process.env): Connection[] {
  const ollamaLocal = isLocalHost(env.OLLAMA_BASE_URL);
  const stackitAi = /\.eu01\.onstackit\.cloud$/.test(safeHost(env.AI_BASE_URL));
  const live = env.MAIL_MODE === "live";
  const smtpLocal = isLocalHost(env.SMTP_HOST ? `smtp://${env.SMTP_HOST}` : undefined);
  return [
    env.AI_PROVIDER === "openai"
      ? {
          id: "ollama",
          name: "KI-Modelle (OpenAI-kompatibel)",
          provider: stackitAi ? "STACKIT AI Model Serving" : "OpenAI-kompatibler Dienst",
          location: stackitAi ? "STACKIT, Region EU01 (Deutschland)" : `unbekannt (${safeHost(env.AI_BASE_URL)}) – Standort prüfen`,
          regions: stackitAi ? ["DE", "EU"] : [],
          outbound: true,
          active: true,
          note: "Embeddings und Antworten. Inhalte gehen an diesen Dienst.",
          replaceable: "Ollama selbst betrieben oder ein anderer OpenAI-kompatibler EU-Dienst",
        }
      : {
          id: "ollama",
          name: "KI-Modelle (Ollama)",
          provider: ollamaLocal ? "lokal" : "entfernter Ollama-Server",
          location: ollamaLocal ? "dieser Rechner" : `unbekannt (${safeHost(env.OLLAMA_BASE_URL)}) – Standort prüfen`,
          regions: ollamaLocal ? ["DE", "EU"] : [],
          outbound: !ollamaLocal,
          active: true,
          note: "Embeddings und Antworten. Inhalte gehen an diesen Server.",
          replaceable: "Jeder Ollama-kompatible Server (z. B. STACKIT/Infercom)",
        },
    {
      id: "smtp",
      name: "E-Mail-Versand (SMTP)",
      provider: live ? safeHost(`smtp://${env.SMTP_HOST ?? ""}`) : "Mailpit (lokal, capture)",
      location: live ? (smtpLocal ? "lokal" : "Anbieter – Standort im AVV prüfen") : "dieser Rechner",
      regions: !live || smtpLocal ? ["DE", "EU"] : [],
      outbound: live && !smtpLocal,
      active: true,
      note: live ? "Echter Versand: Empfängeradressen und Inhalte gehen an den SMTP-Dienst." : "Nichts verlässt den Rechner.",
      replaceable: "Jeder SMTP-Dienst bzw. eigener Postfix",
    },
    {
      id: "youtube",
      name: "YouTube Data API",
      provider: "Google LLC",
      location: "USA",
      regions: [],
      outbound: true,
      active: !!env.YOUTUBE_API_KEY,
      note: "Nur lesend: öffentliche Kanalkennzahlen. Keine Kundendaten.",
      replaceable: "Manuelle Eingabe der Kennzahlen",
    },
    // Social-Kanäle, nur lesend (src/lib/channels) – nur eigene Kanäle, nur aggregierte Kennzahlen
    {
      id: "social-linkedin",
      name: "LinkedIn Community Management API",
      provider: "LinkedIn Ireland / LinkedIn Corp. (Microsoft)",
      location: "USA/Irland",
      regions: [],
      outbound: true,
      active: Boolean(env.LINKEDIN_CLIENT_ID && env.LINKEDIN_CLIENT_SECRET),
      note: "Nur lesend: Follower, Impressionen und Beitragsstatistik eigener Unternehmensseiten. Keine Kundendaten werden gesendet; Token verschlüsselt gespeichert.",
      replaceable: "Export-Import (CSV) oder manuelle Eingabe",
    },
    {
      id: "social-meta",
      name: "Meta Graph API (Facebook, Instagram)",
      provider: "Meta Platforms Ireland / Meta Platforms Inc.",
      location: "USA/Irland",
      regions: [],
      outbound: true,
      active: Boolean(env.META_APP_ID && env.META_APP_SECRET),
      note: "Nur lesend: Follower, Aufrufe und Beitragskennzahlen eigener Seiten/Konten. Keine Kommentartexte oder Follower-Listen.",
      replaceable: "Export aus der Meta Business Suite (CSV) oder manuelle Eingabe",
    },
    {
      id: "social-x",
      name: "X API v2",
      provider: "X Corp.",
      location: "USA",
      regions: [],
      outbound: true,
      active: Boolean(env.X_BEARER_TOKEN),
      note: "Nur lesend, öffentliche Kennzahlen eigener Konten; kostenpflichtig je gelesenem Beitrag (Pay-per-use).",
      replaceable: "X-Analytics-Export (CSV) oder manuelle Eingabe",
    },
    {
      id: "social-tiktok",
      name: "TikTok Display API",
      provider: "TikTok Technology Ltd. (Irland) / TikTok Inc.",
      location: "Irland/USA/Singapur",
      regions: [],
      outbound: true,
      active: Boolean(env.TIKTOK_CLIENT_KEY && env.TIKTOK_CLIENT_SECRET),
      note: "Nur lesend: Follower und Video-Kennzahlen des eigenen Kontos.",
      replaceable: "Manuelle Eingabe",
    },
    {
      id: "url-fetch",
      name: "URL-Abruf der Wissensbasis",
      provider: "beliebige Websites (vom Benutzer eingegeben)",
      location: "je Ziel",
      regions: ["DE", "EU"],
      outbound: true,
      active: true,
      note: "Ruft nur die eingegebene Adresse ab; sendet keine CRM-Daten.",
      replaceable: "Text manuell einfügen",
    },
    {
      id: "searxng",
      name: "Eigene Suchmaschine (SearXNG)",
      provider: env.SEARXNG_URL ? `SearXNG (${safeHost(env.SEARXNG_URL)}) → Suchdienste: ${env.SEARXNG_ENGINES ?? "mojeek,startpage,duckduckgo"}` : "nicht eingerichtet",
      location: "Instanz: eigener Server; Suchbegriffe gehen an die konfigurierten Suchdienste (je Dienst prüfen)",
      regions: ["EU"],
      outbound: Boolean(env.SEARXNG_URL),
      active: Boolean(env.SEARXNG_URL),
      // Automatisch nur über die Presse-Überwachung; Anreicherung/Recherche sonst nur per Knopfdruck
      onlyWhen: "mentionMonitoring",
      note: "Nur bei Anreicherung/Recherche auf Knopfdruck oder eingeschalteter Presse-Überwachung. Nur Suchbegriffe (Firmen-/Personennamen), keine CRM-Daten. Suchdienste per SEARXNG_ENGINES wählbar (EU-nahe zuerst).",
      replaceable: "Andere Suchdienste in SearXNG oder Suche abschalten",
    },
    {
      id: "enrich-web",
      name: "Abruf öffentlicher Firmen-Websites (Anreicherung)",
      provider: "Website des jeweiligen Unternehmens",
      location: "je Ziel",
      regions: ["DE", "EU"],
      outbound: true,
      active: true,
      note: "Liest Startseite, Impressum, Kontakt/Team (max. 8 Seiten, robots.txt beachtet). Sendet keine CRM-Daten.",
      replaceable: "Daten manuell pflegen",
    },
    {
      id: "dns",
      name: "DNS-Abfragen (Pflichten-Prüfung)",
      provider: "System-Resolver",
      location: "je Resolver",
      regions: ["DE", "EU"],
      outbound: true,
      active: true,
      note: "Fragt SPF/DKIM/DMARC der eigenen Domains ab.",
      replaceable: "Eigener Resolver",
    },
    {
      id: "agent-api",
      name: "Agent-API / MCP (eingehend)",
      provider: "eigene Schnittstelle",
      location: "dieser Server",
      regions: ["DE", "EU"],
      outbound: false,
      active: true,
      note: "Externe KI-Agenten fragen an; Antworten nur aus freigegebenem Wissen.",
      replaceable: "abschaltbar",
    },
    // Presse-/Erwähnungs-Recherche (src/lib/research)
    {
      id: "research-gdelt",
      name: "Presse-Recherche: GDELT",
      provider: "The GDELT Project (offene Nachrichten-Datenbank)",
      location: "USA",
      regions: [],
      outbound: true,
      active: env.RESEARCH_GDELT !== "off",
      onlyWhen: "mentionMonitoring",
      note: "Nur wenn die Presse-Überwachung im Sub-Account eingeschaltet ist oder eine Firma manuell recherchiert wird. Suchbegriffe = öffentliche Firmennamen verlassen die EU. Personen-Namen werden NICHT an GDELT gesendet. Abschaltbar mit RESEARCH_GDELT=off.",
      replaceable: "Nur eigene Suchmaschine (SearXNG) und Firmen-Websites",
    },
    {
      id: "research-searxng",
      name: "Presse-Recherche: eigene Suchmaschine (SearXNG)",
      provider: "eigene Instanz → konfigurierte Suchdienste",
      location: isLocalHost(env.SEARXNG_URL ?? "http://127.0.0.1:58080") ? "dieser Server, Weiterleitung an Suchdienste" : safeHost(env.SEARXNG_URL) ?? "unbekannt",
      regions: ["DE", "EU"],
      outbound: true,
      active: true,
      note: "Die Instanz läuft selbst betrieben; Suchbegriffe (Firmennamen, bei freigeschalteter Personen-Anreicherung auch Name + Firma) gehen an die dort konfigurierten Suchdienste – für reine EU-Verarbeitung nur EU-Dienste aktivieren.",
      replaceable: "Anderer Suchdienst oder nur Firmen-Websites",
    },
    // --- STACKIT DNS (Domains) ---
    {
      id: "stackit-dns",
      name: "DNS-Verwaltung: STACKIT DNS (Plattform-Projekt)",
      provider: "STACKIT (Schwarz Digits)",
      location: "Deutschland",
      regions: ["DE", "EU"],
      outbound: true,
      active: Boolean(env.STACKIT_DNS_PROJECT_ID && (env.STACKIT_DNS_TOKEN || env.STACKIT_SERVICE_ACCOUNT_KEY_PATH || env.STACKIT_SERVICE_ACCOUNT_KEY)),
      note: "Zonen und DNS-Einträge der Kunden-Domains (nur DNS-Daten: Hostnamen, Ziele, TXT-Werte). Zugang per Service Account des Pioneerdesk-Projekts, Schlüssel nur auf dem Server, nicht in der Datenbank.",
      replaceable: "Jeder DNS-Anbieter (Rückweg per BIND-Zonendatei, Nameserver beim Registrar zurückstellen)",
    },
    // --- WhatsApp & SMS (Posteingang) ---
    {
      id: "messaging-whatsapp",
      name: "WhatsApp Business (Meta Cloud API)",
      provider: "Meta Platforms Ireland Ltd. (Konzern: USA)",
      location: "Irland/USA – Nachrichten bei aktivierter „Local storage“ (EU, Deutschland) nach der Verarbeitung nur in der EU gespeichert",
      regions: [],
      outbound: true,
      active: env.MESSAGING_MODE === "live",
      note: "Nur aktiv, wenn ein WhatsApp-Kanal eingerichtet ist. Inhalte, Rufnummern und Profilnamen der Kunden gehen an Meta; Ende-zu-Ende bis zur Cloud API, dort verarbeitet. Local storage je Rufnummer auf EU stellen.",
      replaceable: "WhatsApp über EU-Anbieter (BSP) oder Verzicht; SMS als Alternative",
    },
    {
      id: "messaging-sms-seven",
      name: "SMS (seven.io)",
      provider: "seven communications GmbH",
      location: "Deutschland",
      regions: ["DE", "EU"],
      outbound: true,
      active: env.MESSAGING_MODE === "live",
      note: "Nur aktiv, wenn ein SMS-Kanal eingerichtet ist. Rufnummern und SMS-Texte gehen an seven.io und die Mobilfunknetze.",
      replaceable: "Andere SMS-Anbieter mit API (z. B. sipgate, CM.com)",
    },
    // --- Zahlungen & Kontoabgleich (src/lib/payments) – je Sub-Account verbunden; aktiv = Live-Zahlungen freigeschaltet ---
    {
      id: "payments-mollie",
      name: "Online-Zahlung: Mollie (Wero, Karte, PayPal, Klarna …)",
      provider: "Mollie B.V. (Amsterdam, Zahlungsinstitut unter Aufsicht der DNB)",
      location: "Niederlande/EU",
      regions: ["EU"],
      outbound: true,
      active: env.PAYMENTS_MODE === "live",
      note: "Nur aktiv, wenn im Sub-Account verbunden. Gesendet werden Betrag, Rechnungsnummer, interne IDs (Metadaten) und Rückleitungs-Adressen; Zahlungsdaten gibt der Kunde direkt bei Mollie ein. Mollie ist eigenständig Verantwortlicher für die Zahlungsabwicklung.",
      replaceable: "Revolut oder Unzer (gleiche Schnittstelle), sonst Überweisung/SEPA-Lastschrift",
    },
    {
      id: "payments-revolut",
      name: "Online-Zahlung: Revolut Merchant · Kontoabgleich: Revolut Business",
      provider: "Revolut Bank UAB (Litauen, EZB/Bank of Lithuania) · Konzern Revolut Ltd (Vereinigtes Königreich)",
      location: "Litauen/EU, Konzern UK",
      regions: ["EU"],
      outbound: true,
      active: env.PAYMENTS_MODE === "live",
      note: "Bezahllinks: Betrag, Rechnungsnummer, ggf. E-Mail des Kunden. Kontoabgleich: nur lesender Zugriff auf Umsätze des eigenen Geschäftskontos (Zertifikat + Refresh-Token verschlüsselt). Datenübermittlung ins Vereinigte Königreich (Angemessenheitsbeschluss) möglich.",
      replaceable: "Mollie/Unzer für Zahlungen; CAMT-Import aus jedem Bankkonto für den Abgleich",
    },
    {
      id: "payments-unzer",
      name: "Online-Zahlung: Unzer (inkl. Wero)",
      provider: "Unzer GmbH (Heidelberg, BaFin-lizenziert)",
      location: "Deutschland",
      regions: ["DE", "EU"],
      outbound: true,
      active: env.PAYMENTS_MODE === "live",
      note: "Nur aktiv, wenn im Sub-Account verbunden. Gesendet werden Betrag, Rechnungsnummer und Rückleitungs-Adresse; Zahlungsdaten gibt der Kunde direkt bei Unzer ein.",
      replaceable: "Mollie oder Revolut (gleiche Schnittstelle), sonst Überweisung/SEPA-Lastschrift",
    },
    // Ergänzt in der Datenschutz-Durchsicht 2026-10-07: weitere Wege, auf denen personenbezogene Daten den Server verlassen
    {
      id: "calendar-google",
      name: "Kalender & Google Meet (Google Calendar API)",
      provider: "Google Ireland Ltd. / Google LLC",
      location: "USA/Irland",
      regions: [],
      outbound: true,
      active: Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
      note: "Nur wenn ein Benutzer seinen Google-Kalender verbindet: Termine mit Titel, Beschreibung (inkl. Angaben aus der Buchung) und Teilnehmenden (Name, E-Mail) gehen an Google. Token verschlüsselt gespeichert.",
      replaceable: "Termine ohne Kalender-Verbindung (ICS-Einladung per E-Mail), Video über Jitsi/OpenTalk",
    },
    {
      id: "calendar-microsoft",
      name: "Kalender & Teams (Microsoft Graph)",
      provider: "Microsoft Ireland Operations Ltd. / Microsoft Corp.",
      location: "EU-Datengrenze möglich, Konzern USA",
      regions: [],
      outbound: true,
      active: Boolean(env.MS_CLIENT_ID && env.MS_CLIENT_SECRET),
      note: "Nur wenn ein Benutzer seinen Microsoft-365-Kalender verbindet: Termine mit Titel, Beschreibung und Teilnehmenden (Name, E-Mail) gehen an Microsoft. Token verschlüsselt gespeichert.",
      replaceable: "Termine ohne Kalender-Verbindung (ICS-Einladung per E-Mail), Video über Jitsi/OpenTalk",
    },
    {
      id: "lexware",
      name: "Buchhaltung: Lexware Office (lexoffice) API",
      provider: "Haufe Service Center GmbH / Lexware",
      location: "Deutschland",
      regions: ["DE", "EU"],
      outbound: true,
      active: Boolean(env.LEXWARE_API_KEY),
      note: "Belege und Empfängerdaten (Name, Anschrift, E-Mail) gehen an Lexware Office. Löschung im CRM wirkt nicht auf Lexware – dort gelten die Aufbewahrungsfristen der Buchhaltung.",
      replaceable: "XRechnung-Export (UBL) je Rechnung und Datenexport (JSON/CSV)",
    },
    {
      id: "storage-s3",
      name: "Dateispeicher (S3-kompatibel)",
      provider: env.S3_ENDPOINT ? safeHost(env.S3_ENDPOINT) : "nicht eingerichtet (lokaler Speicher)",
      location: env.S3_ENDPOINT?.includes("stackit") ? "Deutschland (STACKIT)" : "Anbieter – Standort im AVV prüfen",
      regions: env.S3_ENDPOINT?.includes("stackit") ? ["DE", "EU"] : [],
      outbound: Boolean(env.S3_ENDPOINT && env.S3_BUCKET),
      active: Boolean(env.S3_ENDPOINT && env.S3_BUCKET),
      note: "Hochgeladene Dateien und Anhänge aus dem Posteingang (können personenbezogene Daten enthalten).",
      replaceable: "Lokaler Speicher (FILE_STORAGE_DIR) oder anderer S3-Anbieter",
    },
    {
      id: "webhooks",
      name: "Webhooks (ausgehend, vom Sub-Account eingerichtet)",
      provider: "vom Sub-Account eingetragene Ziel-Adressen",
      location: "je Ziel – Standort und AVV des Empfängers prüfen",
      regions: ["DE", "EU"],
      outbound: true,
      active: true,
      note: "Nur wenn im Sub-Account Webhooks eingerichtet sind: Ereignisse mit Kontaktdaten (E-Mail-Adresse, Versandstatus) gehen an die eingetragene Adresse.",
      replaceable: "Webhooks abschalten; Daten per API abholen",
    },
    {
      id: "inbox-imap",
      name: "Posteingang: E-Mail-Postfächer (IMAP/SMTP)",
      provider: "Postfach-Anbieter des Sub-Accounts",
      location: "je Anbieter – Standort im AVV prüfen",
      regions: ["DE", "EU"],
      outbound: true,
      active: true,
      note: "Nur wenn ein E-Mail-Postfach verbunden ist: Nachrichten werden abgerufen und Antworten über das Postfach versendet. Zugangsdaten verschlüsselt gespeichert.",
      replaceable: "Anderer Postfach-Anbieter",
    },
  ];
}

function safeHost(url: string | undefined) {
  try {
    return new URL(url ?? "").hostname || "nicht gesetzt";
  } catch {
    return "nicht gesetzt";
  }
}
