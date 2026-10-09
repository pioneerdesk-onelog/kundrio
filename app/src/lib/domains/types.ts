// Gemeinsame Typen für eigene Domains.

export type RecordType = "A" | "AAAA" | "CNAME" | "TXT" | "MX";

/** Soll-Eintrag (vollqualifizierter Name ohne Punkt am Ende). */
export type DesiredRecord = {
  type: RecordType;
  name: string;
  value: string;
  ttl: number;
  // landing | verify | spf | dkim | dmarc
  purpose: string;
  /** TXT-Einträge wie SPF: Prüfung „beginnt mit“ statt exakt (bestehende SPF-Einträge werden ergänzt, nicht ersetzt) */
  match?: "exact" | "prefix" | "contains";
};

export type DomainPurpose = "landing" | "mail";
export type DomainMethod = "api" | "domain_connect" | "manual" | "stackit_managed";
export type DomainStatus = "pending_dns" | "verifying" | "active" | "error" | "removed";

export type RecordCheck = {
  type: RecordType;
  name: string;
  expected: string;
  purpose: string;
  status: "ok" | "missing" | "wrong";
  found: string[];
  /** Resolver-Name → gefundene Werte (Propagation) */
  perResolver: Record<string, string[]>;
  okResolvers: number;
  totalResolvers: number;
};

export type CertCheck = { ok: boolean; issuer?: string; validTo?: string; daysLeft?: number; error?: string };

export type CheckReport = {
  checkedAt: string;
  records: RecordCheck[];
  ownership: boolean;
  /** Auflösung des Hostnamens: CNAME-Kette bis zum Ziel */
  cnameChain: string[];
  /** Anzahl Resolver, bei denen alle Pflicht-Einträge stimmen */
  propagation: { ok: number; total: number };
  allRequiredOk: boolean;
  https?: CertCheck;
};
