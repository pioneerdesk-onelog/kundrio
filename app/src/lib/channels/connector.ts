// Einheitliche Konnektor-Schnittstelle je Plattform (nur lesend).
import type { AccountCandidate, AccountMetrics, Credentials, Platform, PostInput } from "./types";

export type AccountRef = { externalId: string | null; handle: string };

export type ExchangeResult = { creds: Credentials; candidates: AccountCandidate[] };

export interface Connector {
  platform: Platform;
  /** OAuth-Start (nur bei mode = oauth) */
  authorizeUrl?(p: { redirectUri: string; state: string; challenge: string }): string;
  /** Code gegen Tokens tauschen und auswählbare Konten liefern */
  exchangeCode?(p: { code: string; redirectUri: string; verifier: string }): Promise<ExchangeResult>;
  /** Token erneuern (falls die Plattform das unterstützt) */
  refresh?(creds: Credentials): Promise<Credentials>;
  /** Tageswerte des Kanals */
  fetchAccountMetrics(account: AccountRef, creds: Credentials | null): Promise<AccountMetrics & { externalId?: string }>;
  /** Beiträge seit `since` mit aggregierten Kennzahlen */
  fetchPosts(account: AccountRef, creds: Credentials | null, since: Date): Promise<PostInput[]>;
}

export const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

export const isoIn = (seconds: unknown): string | null => {
  const s = num(seconds);
  return s == null ? null : new Date(Date.now() + s * 1000).toISOString();
};

export const shortTitle = (text: unknown, max = 140): string | null => {
  if (typeof text !== "string") return null;
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return null;
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};
