export function contactName(c: { firstName?: string | null; lastName?: string | null; email?: string | null } | null | undefined) {
  if (!c) return "";
  return [c.firstName, c.lastName].filter(Boolean).join(" ") || c.email || "Ohne Namen";
}

export function parseTags(raw: string | null | undefined): string[] {
  return Array.from(new Set((raw ?? "").split(/[,;|]/).map((t) => t.trim()).filter(Boolean))).slice(0, 30);
}

/** "1.234,56" oder "1234.56" → Cent */
export function euroToCents(raw: string | null | undefined): number {
  const s = (raw ?? "").trim().replace(/\s|€/g, "");
  if (!s) return 0;
  const normalized = s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s;
  const n = Number(normalized);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : 0;
}

/** Wert für <input type="datetime-local"> in lokaler Zeit */
export function toLocalInput(d: Date | null | undefined) {
  if (!d) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Anzahl mit Einzahl/Mehrzahl und Tausenderpunkt: plural(1, "Deal", "Deals") → „1 Deal“, plural(1200, …) → „1.200 Deals“ */
export function plural(n: number, one: string, many: string) {
  return `${n.toLocaleString("de-DE")} ${n === 1 ? one : many}`;
}

/** Tageskennung „2026-10-07“ → „07.10.2026“ (deutsches Datumsformat in Diagramm-Legende, Tooltip und Tabelle). */
export function formatDay(iso: string) {
  return /^\d{4}-\d{2}-\d{2}/.test(iso) ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : iso;
}
