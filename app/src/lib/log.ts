// Strukturierte JSON-Logs (eine Zeile pro Ereignis) für STACKIT Observability/Loki o. ä.
// Keine personenbezogenen Daten loggen: keine E-Mail-Adressen, Namen, Inhalte, IPs, Tokens.
// Felder mit verdächtigen Namen werden zusätzlich maskiert.

type Level = "debug" | "info" | "warn" | "error";
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const SENSITIVE = /(pass|secret|token|key|auth|cookie|email|mail|phone|name|ip|address|body|content)/i;

function minLevel(): Level {
  const l = (process.env.LOG_LEVEL ?? "info") as Level;
  return l in ORDER ? l : "info";
}

// E-Mail-Adressen auch INNERHALB von Texten maskieren (z. B. „550 <a@b.de>: Recipient address rejected“ aus SMTP-Fehlern)
const EMAIL_IN_TEXT = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const maskText = (s: string) => s.replace(EMAIL_IN_TEXT, "[E-Mail]");

function scrub(fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (SENSITIVE.test(k) && !/^(jobId|runId|workspaceId|type|nodeType|kind)$/.test(k)) out[k] = "[maskiert]";
    else if (v instanceof Error) out[k] = maskText(v.message.slice(0, 500));
    else if (typeof v === "string") out[k] = maskText(v);
    else out[k] = v;
  }
  return out;
}

function write(level: Level, msg: string, fields: Record<string, unknown> = {}) {
  if (ORDER[level] < ORDER[minLevel()]) return;
  const line = JSON.stringify({ ts: new Date().toISOString(), level, msg: maskText(msg), ...scrub(fields) });
  if (level === "error" || level === "warn") process.stderr.write(line + "\n");
  else process.stdout.write(line + "\n");
}

export const log = {
  debug: (msg: string, f?: Record<string, unknown>) => write("debug", msg, f),
  info: (msg: string, f?: Record<string, unknown>) => write("info", msg, f),
  warn: (msg: string, f?: Record<string, unknown>) => write("warn", msg, f),
  error: (msg: string, f?: Record<string, unknown>) => write("error", msg, f),
};

/** Fehlermeldung ohne Stacktrace/Interna für Logs. */
export function errMessage(e: unknown): string {
  return (e instanceof Error ? e.message : String(e)).slice(0, 500);
}
