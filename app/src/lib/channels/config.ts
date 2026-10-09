// Konfiguration je Plattform aus der Umgebung + verständliche Einrichtungshinweise. Rein (testbar).
import type { Platform } from "./types";

export type ConnectMode = "oauth" | "key" | "import";

export type PlatformInfo = {
  platform: Platform;
  /** oauth = Konto verbinden, key = App-Schlüssel genügt, import = nur Export-Import/manuell */
  mode: ConnectMode;
  configured: boolean;
  /** Was Marcus/der Admin einrichten muss (Deutsch, kurz) */
  setup: string[];
  /** Nur lesende Berechtigungen, die angefragt werden */
  scopes: string[];
  /** Wichtige Einschränkungen (Kosten, Datenzeitraum, App-Prüfung) */
  limits: string[];
  envVars: string[];
};

type Env = Record<string, string | undefined>;

export function redirectUri(appUrl: string, platform: Platform) {
  return `${appUrl.replace(/\/$/, "")}/api/channels/oauth/${platform}/callback`;
}

export function platformInfo(platform: Platform, env: Env = process.env, appUrl = env.APP_URL ?? "http://127.0.0.1:3100"): PlatformInfo {
  const cb = redirectUri(appUrl, platform);
  switch (platform) {
    case "linkedin":
      return {
        platform,
        mode: "oauth",
        configured: Boolean(env.LINKEDIN_CLIENT_ID && env.LINKEDIN_CLIENT_SECRET),
        envVars: ["LINKEDIN_CLIENT_ID", "LINKEDIN_CLIENT_SECRET", "LINKEDIN_API_VERSION"],
        scopes: ["rw_organization_admin", "r_organization_social"],
        setup: [
          "App im LinkedIn Developer Portal anlegen und mit der Unternehmensseite verknüpfen.",
          "Produkt „Community Management API“ beantragen – LinkedIn prüft und gibt frei.",
          `Redirect-URL eintragen: ${cb}`,
          "Client-ID und Secret als LINKEDIN_CLIENT_ID / LINKEDIN_CLIENT_SECRET hinterlegen.",
          "Verbinden als Administrator der Unternehmensseite.",
        ],
        limits: [
          "Statistiken nur für Seiten, deren Admin verbindet.",
          "Zeitbezogene Follower-/Beitragsstatistiken max. 12 Monate rückwirkend, bis 2 Tage vor heute.",
          "Zugangstoken 60 Tage gültig; danach neu verbinden (Refresh nur für freigegebene Partner).",
          "LinkedIn verlangt den Scope rw_organization_admin auch fürs Lesen der Statistiken – das CRM schreibt nichts.",
        ],
      };
    case "facebook":
    case "instagram":
      return {
        platform,
        mode: "oauth",
        configured: Boolean(env.META_APP_ID && env.META_APP_SECRET),
        envVars: ["META_APP_ID", "META_APP_SECRET", "META_GRAPH_VERSION"],
        scopes:
          platform === "facebook"
            ? ["pages_show_list", "pages_read_engagement", "read_insights"]
            : ["pages_show_list", "pages_read_engagement", "instagram_basic", "instagram_manage_insights"],
        setup: [
          "App im Meta for Developers Portal (Typ „Business“) anlegen, Produkt „Facebook Login for Business“ hinzufügen.",
          `Gültige OAuth-Redirect-URI: ${cb}`,
          "Für eigene Seiten/Konten genügt „Standard Access“ (Rollen in der App); für Kundenkonten ist App-Prüfung + Business-Verifizierung nötig.",
          "App-ID und Secret als META_APP_ID / META_APP_SECRET hinterlegen.",
          platform === "instagram" ? "Instagram-Konto muss Business/Creator und mit einer Facebook-Seite verknüpft sein." : "Verbinden als Admin der Facebook-Seite.",
        ],
        limits: [
          "Seiten-Token aus langlebigem Benutzer-Token läuft nicht ab, wird aber ungültig bei Passwortwechsel/Rechteentzug.",
          "Meta hat zum 15.06.2026 mehrere Page-Insights-Metriken abgeschaltet (Impressions → Views, Fans → Follower).",
          "Instagram-Insights: Nutzerdaten max. 90 Tage rückwirkend.",
        ],
      };
    case "x":
      return {
        platform,
        mode: "key",
        configured: Boolean(env.X_BEARER_TOKEN),
        envVars: ["X_BEARER_TOKEN", "X_MAX_POSTS_PER_SYNC"],
        scopes: ["App-only Bearer Token (nur öffentliche Daten)"],
        setup: [
          "Projekt + App im X Developer Portal anlegen (kostenpflichtig: Pay-per-use).",
          "Bearer Token als X_BEARER_TOKEN hinterlegen.",
          "Optional X_MAX_POSTS_PER_SYNC begrenzen (Standard 10) – jeder gelesene Beitrag kostet.",
        ],
        limits: [
          "Kein kostenloser Lesezugang mehr: Free-Tarif nur Schreiben; neue Konten nur Pay-per-use (ca. 0,005 USD je gelesenem Beitrag) oder Enterprise.",
          "Gelesen werden nur öffentliche Kennzahlen (Follower, Beiträge, Likes/Reposts/Antworten).",
        ],
      };
    case "tiktok":
      return {
        platform,
        mode: "oauth",
        configured: Boolean(env.TIKTOK_CLIENT_KEY && env.TIKTOK_CLIENT_SECRET),
        envVars: ["TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET"],
        scopes: ["user.info.basic", "user.info.stats", "video.list"],
        setup: [
          "App im TikTok for Developers Portal anlegen, Login Kit + Display API hinzufügen.",
          "Scopes user.info.basic, user.info.stats, video.list beantragen – TikTok prüft die App vor Produktivbetrieb.",
          `Redirect-URI: ${cb}`,
          "Client Key/Secret als TIKTOK_CLIENT_KEY / TIKTOK_CLIENT_SECRET hinterlegen.",
        ],
        limits: ["Zugangstoken 24 h, Refresh-Token 1 Jahr (wird automatisch erneuert).", "Nur eigenes Konto; Videos mit Aufrufen/Likes/Kommentaren/Shares."],
      };
    case "youtube":
      return {
        platform,
        mode: "key",
        configured: Boolean(env.YOUTUBE_API_KEY),
        envVars: ["YOUTUBE_API_KEY"],
        scopes: ["API-Schlüssel (nur öffentliche Daten)"],
        setup: ["YouTube Data API v3 in der Google Cloud Console aktivieren, API-Schlüssel erzeugen (auf diese API beschränken).", "Als YOUTUBE_API_KEY hinterlegen."],
        limits: ["Öffentliche Kanalstatistik + letzte Videos; Tageskontingent der API (10.000 Einheiten)."],
      };
    case "xing":
      return {
        platform,
        mode: "import",
        configured: true,
        envVars: [],
        scopes: [],
        setup: ["XING bietet keine öffentliche Schnittstelle für Seitenstatistiken – Kennzahlen manuell eintragen oder als CSV importieren."],
        limits: [],
      };
    default:
      return { platform, mode: "import", configured: true, envVars: [], scopes: [], setup: [], limits: [] };
  }
}

/** Kann dieser Kanal automatisch abgerufen werden (API/Schlüssel), sofern konfiguriert? */
export function supportsApi(platform: Platform) {
  return ["youtube", "linkedin", "facebook", "instagram", "x", "tiktok"].includes(platform);
}
