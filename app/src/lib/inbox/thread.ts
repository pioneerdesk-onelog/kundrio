// Reine Hilfen für den Posteingang (ohne DB): Gesprächszuordnung, Betreff-Normalisierung,
// Erkennung automatischer Antworten und Spam-Markierungen. Auch in Tests nutzbar.

/** Entfernt Antwort-/Weiterleitungs-Präfixe (Re:, AW:, WG:, Fwd:, …) und Mehrfach-Leerzeichen. */
export function normalizeSubject(subject: string | null | undefined): string {
  let s = (subject ?? "").trim();
  // wiederholt entfernen: „AW: WG: Re[2]: Angebot“ → „Angebot“
  const prefix = /^\s*(re|aw|wg|fw|fwd|antw|sv|vs|tr|r)\s*(\[\d+\]|\(\d+\))?\s*:\s*/i;
  for (let i = 0; i < 10 && prefix.test(s); i++) s = s.replace(prefix, "");
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

/** Nimmt „Name <a@b.de>“ oder „a@b.de“ und liefert die kleingeschriebene Adresse. */
export function bareEmail(addr: string | null | undefined): string {
  const s = (addr ?? "").trim();
  const m = s.match(/<([^>]+)>/);
  return (m ? m[1] : s).trim().toLowerCase();
}

/** Message-IDs vereinheitlichen (mit spitzen Klammern, ohne Leerzeichen). */
export function normalizeMessageId(id: string | null | undefined): string | null {
  const s = (id ?? "").trim();
  if (!s) return null;
  const inner = s.replace(/^<|>$/g, "").trim();
  return inner ? `<${inner}>` : null;
}

/** References-Header (Leerzeichen-getrennt) in Liste zerlegen. */
export function parseReferences(raw: string | string[] | null | undefined): string[] {
  const list = Array.isArray(raw) ? raw : (raw ?? "").split(/\s+/);
  return list.map(normalizeMessageId).filter((x): x is string => Boolean(x));
}

/**
 * Gesprächsschlüssel einer E-Mail: Wurzel der Unterhaltung (erste Referenz), sonst In-Reply-To,
 * sonst die eigene Message-ID. Dieselbe Unterhaltung ergibt so bei allen Antworten denselben Schlüssel.
 */
export function emailThreadKey(m: { messageId: string; inReplyTo?: string | null; references?: string[] }): string {
  const refs = (m.references ?? []).map(normalizeMessageId).filter(Boolean) as string[];
  return refs[0] ?? normalizeMessageId(m.inReplyTo) ?? normalizeMessageId(m.messageId) ?? m.messageId;
}

/** Alle Message-IDs, über die eine eingehende Antwort an ein bestehendes Gespräch hängen kann. */
export function relatedMessageIds(m: { inReplyTo?: string | null; references?: string[] }): string[] {
  const ids = new Set<string>();
  const irt = normalizeMessageId(m.inReplyTo);
  if (irt) ids.add(irt);
  for (const r of m.references ?? []) {
    const n = normalizeMessageId(r);
    if (n) ids.add(n);
  }
  return [...ids];
}

type HeaderMap = Record<string, string | string[] | undefined>;

function header(h: HeaderMap, name: string): string {
  const v = h[name.toLowerCase()] ?? h[name];
  return (Array.isArray(v) ? v.join(" ") : v ?? "").toString().toLowerCase();
}

/**
 * Automatische Antwort (Abwesenheit, Zustellbenachrichtigung, Autoresponder)?
 * Grundlage: RFC 3834 (Auto-Submitted), gängige Herstellerheader und typische Betreffzeilen.
 */
export function isAutoReply(headers: HeaderMap, subject?: string | null, from?: string | null): boolean {
  const auto = header(headers, "auto-submitted");
  if (auto && auto !== "no") return true;
  if (header(headers, "x-autoreply") || header(headers, "x-autorespond") || header(headers, "x-autoresponder")) return true;
  const supp = header(headers, "x-auto-response-suppress");
  if (/\b(all|oof|autoreply)\b/.test(supp)) return true;
  const prec = header(headers, "precedence");
  if (/\b(auto_reply|bulk|junk)\b/.test(prec)) return true;
  if (header(headers, "x-ms-exchange-inbox-rules-loop")) return true;
  const s = (subject ?? "").toLowerCase();
  if (/^(automatische antwort|abwesenheitsnotiz|out of office|automatic reply|autoreply|abwesend)\b/.test(s)) return true;
  const f = (from ?? "").toLowerCase();
  if (/^(mailer-daemon|postmaster)@/.test(bareEmail(f))) return true;
  return false;
}

/** Als Spam markiert (durch den Mailserver)? */
export function isSpam(headers: HeaderMap): boolean {
  const flag = header(headers, "x-spam-flag");
  if (flag.startsWith("yes")) return true;
  const status = header(headers, "x-spam-status");
  if (status.startsWith("yes")) return true;
  const ms = header(headers, "x-ms-exchange-organization-scl");
  const scl = Number.parseInt(ms, 10);
  if (Number.isFinite(scl) && scl >= 5) return true;
  return false;
}

/** Rufnummer grob nach E.164 (Standard Deutschland) für den Vergleich. */
export function normalizePhone(raw: string | null | undefined, defaultCountry = "49"): string | null {
  // „+49 (0)171 …“: die eingeklammerte Verkehrsausscheidungsziffer entfällt
  let s = (raw ?? "").replace(/\(0\)/g, "").replace(/[^\d+]/g, "");
  if (!s) return null;
  if (s.startsWith("00")) s = `+${s.slice(2)}`;
  else if (s.startsWith("0")) s = `+${defaultCountry}${s.slice(1)}`;
  else if (!s.startsWith("+")) s = `+${s}`;
  const digits = s.slice(1).replace(/\D/g, "");
  return digits.length >= 6 ? `+${digits}` : null;
}

/** Vorname/Nachname aus einem Anzeigenamen („Müller, Anna“ oder „Anna Müller“). */
export function splitName(name: string | null | undefined): { firstName?: string; lastName?: string } {
  const n = (name ?? "").replace(/["']/g, "").trim();
  if (!n || n.includes("@")) return {};
  if (n.includes(",")) {
    const [last, first] = n.split(",").map((x) => x.trim());
    return { firstName: first || undefined, lastName: last || undefined };
  }
  const parts = n.split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0] };
  return { firstName: parts.slice(0, -1).join(" "), lastName: parts[parts.length - 1] };
}
