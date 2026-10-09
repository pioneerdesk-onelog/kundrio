// Gemeinsame Typen für Social-Kanäle (nur lesend). Rein, ohne Server-Abhängigkeiten (testbar).

export const PLATFORMS = ["youtube", "linkedin", "facebook", "instagram", "x", "tiktok", "xing", "website", "newsletter"] as const;
export type Platform = (typeof PLATFORMS)[number];

export const PLATFORM_LABELS: Record<Platform, string> = {
  youtube: "YouTube",
  linkedin: "LinkedIn",
  facebook: "Facebook",
  instagram: "Instagram",
  x: "X",
  tiktok: "TikTok",
  xing: "XING",
  website: "Website",
  newsletter: "Newsletter",
};

/** Tageswerte eines Kanals (entspricht ChannelMetric). null = unbekannt/nicht geliefert. */
export type AccountMetrics = {
  followers: number | null;
  views: number | null;
  posts: number | null;
  extra: Record<string, unknown>;
};

/** Beitrag mit aggregierten Kennzahlen (keine Kommentartexte, keine Follower-Listen). */
export type PostMetrics = {
  impressions?: number | null;
  views?: number | null;
  likes?: number | null;
  comments?: number | null;
  shares?: number | null;
  clicks?: number | null;
  engagementRate?: number | null;
};

export type PostInput = {
  externalId: string;
  url: string | null;
  title: string | null;
  publishedAt: Date | null;
  metrics: PostMetrics;
};

/** Zugangsdaten – werden nur verschlüsselt gespeichert (ChannelAccount.credentials). */
export type Credentials = {
  accessToken: string;
  refreshToken?: string | null;
  expiresAt?: string | null; // ISO
  refreshExpiresAt?: string | null; // ISO
  /** z. B. Seiten-Token (Meta), auswählbare Konten nach dem Verbinden */
  extra?: Record<string, unknown>;
};

/** Konto, das nach dem Verbinden ausgewählt werden kann (Seite, Organisation, IG-Konto). */
export type AccountCandidate = { id: string; name: string; handle?: string | null; url?: string | null; token?: string };

/** Fehler, nach dem der Benutzer neu verbinden muss (kein automatischer Wiederholungsversuch). */
export class ReauthRequiredError extends Error {
  readonly reauth = true;
}

/** Vorübergehender Fehler (Rate-Limit, 5xx) – Job darf wiederholen. */
export class TransientChannelError extends Error {
  readonly transient = true;
}
