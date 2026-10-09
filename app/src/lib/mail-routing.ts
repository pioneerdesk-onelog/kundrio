// Empfänger-Routing für den Versand (rein, ohne DB – testbar).
// MAIL_MODE=capture → alles an Mailpit.
// MAIL_MODE=live ohne MAIL_LIVE_ALLOWLIST → alles über das echte Relay (Produktion).
// MAIL_MODE=live mit MAIL_LIVE_ALLOWLIST → nur Empfänger auf der Liste live, alle anderen an Mailpit.

export type Delivery = "live" | "captured" | "mixed";
export type Recipients = { to: string[]; cc?: string[]; bcc?: string[] };

/** Liest die Freigabeliste: kommagetrennt, Einträge sind Adressen oder `@domain`. Leer → null (keine Liste). */
export function parseAllowlist(raw: string | undefined | null): string[] | null {
  const items = (raw ?? "")
    .split(/[,;\s]+/)
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 2 && s.includes("@"));
  return items.length ? Array.from(new Set(items)) : null;
}

/** Reine Adresse aus "Name <a@b.de>" bzw. "a@b.de". */
export function bareAddress(addr: string): string {
  return (addr.match(/<([^>]+)>/)?.[1] ?? addr).trim().toLowerCase();
}

export function isAllowed(addr: string, allowlist: string[]): boolean {
  const email = bareAddress(addr);
  const domain = email.split("@").pop() ?? "";
  return allowlist.some((entry) => (entry.startsWith("@") ? `@${domain}` === entry : entry === email));
}

/** Teilt Empfänger auf echte Zustellung und Mailpit auf. */
export function routeRecipients(r: Recipients, mode: "live" | "capture", allowlist: string[] | null): { live: Recipients; captured: Recipients } {
  const empty: Recipients = { to: [], cc: [], bcc: [] };
  const all: Recipients = { to: [...r.to], cc: [...(r.cc ?? [])], bcc: [...(r.bcc ?? [])] };
  if (mode === "capture") return { live: empty, captured: all };
  if (!allowlist) return { live: all, captured: { to: [], cc: [], bcc: [] } };
  const pick = (list: string[], ok: boolean) => list.filter((a) => isAllowed(a, allowlist) === ok);
  return {
    live: { to: pick(all.to, true), cc: pick(all.cc!, true), bcc: pick(all.bcc!, true) },
    captured: { to: pick(all.to, false), cc: pick(all.cc!, false), bcc: pick(all.bcc!, false) },
  };
}

export const countRecipients = (r: Recipients) => r.to.length + (r.cc?.length ?? 0) + (r.bcc?.length ?? 0);

export function deliveryOf(route: { live: Recipients; captured: Recipients }): Delivery {
  const l = countRecipients(route.live);
  const c = countRecipients(route.captured);
  return l && c ? "mixed" : l ? "live" : "captured";
}

/** SMTP-Transportoptionen fürs Relay: Port 465 = implizites TLS, sonst STARTTLS erzwingen (z. B. Brevo 587). */
export function relayTlsOptions(port: number, secureEnv: boolean) {
  const secure = secureEnv || port === 465;
  return { secure, requireTLS: !secure && port !== 25 && port !== 1025 && port !== 51025 };
}
