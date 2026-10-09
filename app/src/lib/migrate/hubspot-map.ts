// Reine Abbildungsfunktionen HubSpot → CRM (ohne DB, testbar).

export const HS_LIFECYCLE: Record<string, string> = {
  subscriber: "subscriber",
  lead: "lead",
  marketingqualifiedlead: "mql",
  salesqualifiedlead: "sql",
  opportunity: "opportunity",
  customer: "customer",
  evangelist: "evangelist",
  other: "other",
};

/** HubSpot-lifecyclestage → unser Schlüssel; eigene (numerische) Phasen → "other" */
export function mapLifecycle(v: unknown): string | null {
  if (typeof v !== "string" || !v.trim()) return null;
  return HS_LIFECYCLE[v.trim().toLowerCase()] ?? "other";
}

export function mapPriority(v: unknown): "low" | "medium" | "high" | "urgent" {
  const s = String(v ?? "").toUpperCase();
  if (s === "LOW") return "low";
  if (s === "HIGH") return "high";
  if (s === "URGENT") return "urgent";
  return "medium";
}

/** HubSpot-Eigenschaftstyp → PropertyDefinition.type */
export function mapPropertyType(type: unknown, fieldType?: unknown): "text" | "number" | "date" | "boolean" | "select" {
  const t = String(type ?? "");
  const f = String(fieldType ?? "");
  if (t === "bool" || f === "booleancheckbox") return "boolean";
  if (t === "number") return "number";
  if (t === "date" || t === "datetime") return "date";
  if (t === "enumeration") return "select";
  return "text";
}

/** "1234.5" → 123450 Cent; ungültig → 0 */
export function centsFromAmount(v: unknown): number {
  const n = Number(String(v ?? "").replace(",", "."));
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(Math.round(n * 100), 1e11);
}

export type HsStage = { id: string; label: string; displayOrder?: number; metadata?: Record<string, unknown> };

/** Deal-Phase: isClosed + probability 1 → WON, isClosed + probability 0 → LOST, sonst OPEN */
export function dealStageKind(s: HsStage): "OPEN" | "WON" | "LOST" {
  const closed = String(s.metadata?.isClosed ?? "false") === "true";
  if (!closed) return "OPEN";
  const p = Number(s.metadata?.probability ?? 0);
  return p >= 1 ? "WON" : "LOST";
}

export function ticketStageKind(s: HsStage): "OPEN" | "CLOSED" {
  return String(s.metadata?.ticketState ?? "").toUpperCase() === "CLOSED" ? "CLOSED" : "OPEN";
}

/** Rechtsgrundlage „Einwilligung“ belegt? (hs_legal_basis enthält z. B. „Freely given consent from contact“) */
export function hasConsentBasis(v: unknown): boolean {
  return typeof v === "string" && /consent/i.test(v);
}

export function isTrue(v: unknown): boolean {
  return v === true || String(v).toLowerCase() === "true";
}

export function stripHtml(html: unknown, max = 5000): string {
  return String(html ?? "")
    .replace(/<(br|\/p|\/div|\/li)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, max);
}

/** Standard-Eigenschaften, die wir in eigene Felder übersetzen (nicht als eigene Felder anlegen). */
export const CONTACT_STD = ["email", "firstname", "lastname", "phone", "mobilephone", "company", "lifecyclestage", "hubspot_owner_id", "hs_email_optout", "hs_legal_basis", "createdate", "website", "jobtitle"];
export const COMPANY_STD = ["name", "domain", "industry", "phone", "city", "address", "zip", "country", "website", "numberofemployees", "lifecyclestage", "hubspot_owner_id", "createdate"];
export const DEAL_STD = ["dealname", "amount", "pipeline", "dealstage", "closedate", "hubspot_owner_id", "createdate"];
export const TICKET_STD = ["subject", "content", "hs_pipeline", "hs_pipeline_stage", "hs_ticket_priority", "source_type", "hubspot_owner_id", "createdate", "closed_date"];

/** Eigene Felder aus HubSpot-Properties herausziehen (nur bekannte eigene Eigenschaften, leere Werte weglassen). */
export function customValues(props: Record<string, unknown> | undefined, custom: { name: string; type: string }[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const c of custom) {
    const v = props?.[c.name];
    if (v === null || v === undefined || v === "") continue;
    if (c.type === "number") {
      const n = Number(v);
      if (Number.isFinite(n)) out[c.name] = n;
    } else if (c.type === "boolean") out[c.name] = isTrue(v);
    else out[c.name] = String(v).slice(0, 2000);
  }
  return out;
}

export function companyAddress(p: Record<string, unknown> | undefined): string | null {
  if (!p) return null;
  const line = [p.address, [p.zip, p.city].filter(Boolean).join(" "), p.country].filter((x) => x && String(x).trim()).map(String);
  return line.length ? line.join("\n").slice(0, 500) : null;
}

/** IDs aus `associations.<typ>.results[]` einer HubSpot-v3-Antwort */
export function assocIds(rec: { associations?: Record<string, { results?: { id: string | number }[] }> }, type: string): string[] {
  return (rec.associations?.[type]?.results ?? []).map((r) => String(r.id));
}
