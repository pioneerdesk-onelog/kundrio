// Konfiguration der Kalender-Anbindungen (Google Calendar, Microsoft Graph) und Video-Fallback.
// Basis-URLs sind für Tests gegen Mock-Server überschreibbar.

export type Provider = "google" | "microsoft";
export const PROVIDERS: Provider[] = ["google", "microsoft"];
export const PROVIDER_LABEL: Record<Provider, string> = { google: "Google Kalender", microsoft: "Microsoft 365 (Outlook)" };

export const VIDEO_PROVIDERS = ["google_meet", "ms_teams", "jitsi", "opentalk", "phone", "onsite", "none"] as const;
export type VideoProvider = (typeof VIDEO_PROVIDERS)[number];
export const VIDEO_LABEL: Record<VideoProvider, string> = {
  google_meet: "Google Meet",
  ms_teams: "Microsoft Teams",
  jitsi: "Jitsi (ohne Konto)",
  opentalk: "OpenTalk",
  phone: "Telefon",
  onsite: "Vor Ort",
  none: "Ohne Video",
};

/** Zeitzone für Eingaben, Vorschläge und Einladungen. */
export const TIME_ZONE = "Europe/Berlin";

/**
 * Minimal nötige Berechtigungen:
 * - Google: Termine anlegen/ändern (calendar.events), Frei/Belegt (calendar.freebusy),
 *   Kalenderliste für die Teamkalender-Auswahl (calendar.calendarlist.readonly), E-Mail-Adresse (openid email).
 * - Microsoft: Calendars.ReadWrite (Termine inkl. Teams-Besprechung, getSchedule), User.Read, offline_access (Refresh-Token).
 */
export const SCOPES: Record<Provider, string[]> = {
  google: [
    "openid",
    "email",
    "https://www.googleapis.com/auth/calendar.events",
    "https://www.googleapis.com/auth/calendar.freebusy",
    "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
  ],
  microsoft: ["openid", "email", "offline_access", "User.Read", "Calendars.ReadWrite"],
};

export const calendarEnv = {
  googleClientId: () => process.env.GOOGLE_CLIENT_ID || "",
  googleClientSecret: () => process.env.GOOGLE_CLIENT_SECRET || "",
  msClientId: () => process.env.MS_CLIENT_ID || "",
  msClientSecret: () => process.env.MS_CLIENT_SECRET || "",
  // "organizations" = nur Geschäftskonten (Teams-Besprechungen gibt es nur dort); alternativ die Tenant-ID
  msTenant: () => process.env.MS_TENANT || "organizations",
  googleAuthBase: () => process.env.GOOGLE_OAUTH_BASE || "https://accounts.google.com",
  googleTokenUrl: () => process.env.GOOGLE_TOKEN_URL || "https://oauth2.googleapis.com/token",
  googleApiBase: () => process.env.GOOGLE_API_BASE || "https://www.googleapis.com",
  googleUserinfoUrl: () => process.env.GOOGLE_USERINFO_URL || "https://openidconnect.googleapis.com/v1/userinfo",
  msLoginBase: () => process.env.MS_LOGIN_BASE || "https://login.microsoftonline.com",
  msGraphBase: () => process.env.MS_GRAPH_BASE || "https://graph.microsoft.com/v1.0",
  jitsiBase: () => (process.env.JITSI_BASE_URL || "https://meet.jit.si").replace(/\/+$/, ""),
  openTalkBase: () => (process.env.OPENTALK_BASE_URL || "").replace(/\/+$/, ""),
};

export function isConfigured(p: Provider): boolean {
  return p === "google"
    ? Boolean(calendarEnv.googleClientId() && calendarEnv.googleClientSecret())
    : Boolean(calendarEnv.msClientId() && calendarEnv.msClientSecret());
}

export function redirectUri(p: Provider): string {
  const base = (process.env.APP_URL || "http://127.0.0.1:3100").replace(/\/+$/, "");
  return `${base}/api/calendar/oauth/${p}/callback`;
}

/** Video-Anbieter → nötige Kalender-Verbindung des Organisators. */
export function requiredConnection(v: VideoProvider): Provider | null {
  if (v === "google_meet") return "google";
  if (v === "ms_teams") return "microsoft";
  return null;
}
