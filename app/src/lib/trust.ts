import { createHmac, timingSafeEqual } from "node:crypto";

// Lead-Echtheit: Score 0–100 (höher = vertrauenswürdiger) mit nachvollziehbaren Signalen.
// Die Bewertung ist eine reine Funktion (testbar); Netz-Prüfungen (MX) laufen im Job trust.score.

export type TrustInput = {
  email?: string | null;
  honeypotFilled?: boolean;
  /** Ausfüllzeit in ms aus signiertem Zeitstempel; null = Zeitstempel fehlt/ungültig; undefined = nicht anwendbar */
  elapsedMs?: number | null;
  userAgent?: string | null;
  /** Anfrage kam über die Agent-Schnittstelle (KI-Assistent eines Kunden) */
  viaAgent?: boolean;
  /** Anzahl Einsendungen derselben Adresse in der letzten Stunde (ohne die aktuelle) */
  recentCount?: number;
  /** MX-Eintrag der Domain: true/false; null/undefined = (noch) nicht geprüft */
  mx?: boolean | null;
};

export type TrustSignal = { key: string; label: string; impact: number };
export type TrustResult = { score: number; signals: TrustSignal[] };

export const DISPOSABLE_DOMAINS = new Set([
  "mailinator.com", "guerrillamail.com", "guerrillamail.de", "sharklasers.com", "10minutemail.com", "10minutemail.de",
  "temp-mail.org", "tempmail.com", "tempmail.de", "tempmailo.com", "trashmail.com", "trashmail.de", "trashmail.net",
  "wegwerfmail.de", "wegwerfmail.net", "wegwerfemail.de", "einrot.com", "spamgourmet.com", "yopmail.com", "yopmail.fr",
  "getnada.com", "nada.email", "dispostable.com", "maildrop.cc", "mailnesia.com", "mintemail.com", "throwawaymail.com",
  "fakeinbox.com", "mohmal.com", "emailondeck.com", "burnermail.io", "mailcatch.com", "spambog.com", "spambog.de",
  "discard.email", "tempr.email", "byom.de", "muell.email", "trash-mail.com", "temp-mail.io", "mail.tm", "inboxkitten.com",
  "moakt.com", "emailfake.com", "fakemail.net", "33mail.com", "anonaddy.me", "mytemp.email", "tmail.ws", "tmpmail.org",
]);

export const FREEMAIL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "web.de", "gmx.de", "gmx.net", "gmx.at", "gmx.ch", "t-online.de", "outlook.com",
  "outlook.de", "hotmail.com", "hotmail.de", "live.com", "live.de", "yahoo.com", "yahoo.de", "icloud.com", "me.com",
  "aol.com", "freenet.de", "posteo.de", "mailbox.org", "proton.me", "protonmail.com", "online.de", "arcor.de",
]);

const BOT_UA = /bot|crawler|spider|headless|phantom|puppeteer|playwright|selenium|curl\/|wget|python-requests|httpclient|go-http-client|java\/|libwww|scrapy/i;
const EMAIL_RE = /^[^\s@"<>()[\],;:]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;

export function emailDomain(email: string | null | undefined): string | null {
  if (!email) return null;
  const at = email.lastIndexOf("@");
  return at > 0 ? email.slice(at + 1).toLowerCase() : null;
}

export function evaluateTrust(input: TrustInput): TrustResult {
  const signals: TrustSignal[] = [];
  const add = (key: string, label: string, impact: number) => signals.push({ key, label, impact });

  if (input.viaAgent) add("via_agent", "Anfrage über KI-Assistent (neutral)", 0);

  if (input.email) {
    const email = input.email.trim();
    const domain = emailDomain(email);
    if (!EMAIL_RE.test(email) || !domain) {
      add("email_invalid", "E-Mail-Adresse formal ungültig", -40);
    } else if (DISPOSABLE_DOMAINS.has(domain)) {
      add("email_disposable", "Wegwerf-E-Mail-Adresse", -40);
    } else if (FREEMAIL_DOMAINS.has(domain)) {
      add("email_freemail", "Freemail-Adresse (neutral)", 0);
    } else {
      add("email_company", "Adresse mit eigener Domain", 5);
    }
    if (input.mx === true) add("mx_ok", "Domain kann E-Mails empfangen (MX)", 10);
    else if (input.mx === false) add("mx_missing", "Domain hat keinen Mailserver (kein MX)", -30);
  } else {
    add("email_missing", "Keine E-Mail-Adresse angegeben", -5);
  }

  if (input.honeypotFilled) add("honeypot", "Verstecktes Spam-Feld ausgefüllt", -60);

  if (input.elapsedMs === null) {
    add("ts_missing", "Ausfüllzeit nicht prüfbar (Zeitstempel fehlt oder ungültig)", -10);
  } else if (typeof input.elapsedMs === "number") {
    if (input.elapsedMs < 1500) add("too_fast", "Formular in unter 1,5 s ausgefüllt", -40);
    else if (input.elapsedMs < 3000) add("fast", "Formular in unter 3 s ausgefüllt", -25);
    else add("time_ok", "Plausible Ausfüllzeit", 5);
  }

  if (input.userAgent && BOT_UA.test(input.userAgent) && !input.viaAgent) {
    add("bot_ua", "Browserkennung deutet auf ein Skript/Bot", -30);
  }

  if ((input.recentCount ?? 0) >= 3) add("burst", "Mehrere Einsendungen derselben Adresse in kurzer Zeit", -15);

  const score = Math.max(0, Math.min(100, 70 + signals.reduce((s, x) => s + x.impact, 0)));
  return { score, signals };
}

export function trustLevel(score: number | null | undefined): { label: string; tone: "ok" | "warn" | "bad" | "neutral" } {
  if (score == null) return { label: "ungeprüft", tone: "neutral" };
  if (score >= 70) return { label: `echt ${score}`, tone: "ok" };
  if (score >= 40) return { label: `prüfen ${score}`, tone: "warn" };
  return { label: `verdächtig ${score}`, tone: "bad" };
}

// --- Signierter Zeitstempel für Formulare (Ausfüllzeit) ---

function tsSig(secret: string, formId: string, ts: number) {
  return createHmac("sha256", secret).update(`formts:${formId}:${ts}`).digest("base64url");
}

export function signFormTimestamp(secret: string, formId: string, now = Date.now()): string {
  return `${now}.${tsSig(secret, formId, now)}`;
}

/** Liefert die Ausfüllzeit in ms oder null, wenn der Zeitstempel fehlt, ungültig oder älter als 24 h ist. */
export function verifyFormTimestamp(secret: string, formId: string, token: string | null | undefined, now = Date.now()): number | null {
  if (!token) return null;
  const [tsRaw, sig] = token.split(".");
  const ts = Number(tsRaw);
  if (!sig || !Number.isSafeInteger(ts) || ts > now + 5_000 || now - ts > 24 * 3600 * 1000) return null;
  const a = Buffer.from(tsSig(secret, formId, ts));
  const b = Buffer.from(sig);
  return a.length === b.length && timingSafeEqual(a, b) ? now - ts : null;
}
