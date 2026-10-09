import { z } from "zod";

// Robuste Auswertung von KI-Antworten: JSON herauslösen, mit zod prüfen, Konfidenz begrenzen.

/** Holt das erste JSON-Objekt aus einer Modellantwort (auch in ```json-Blöcken). */
export function extractJson(raw: string): unknown {
  const cleaned = raw.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  const fenced = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : cleaned;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("KI-Antwort enthält kein JSON");
  return JSON.parse(body.slice(start, end + 1));
}

const confidence = z.coerce.number().min(0).max(1).catch(0);

export function parseClassification(raw: string, categories: string[]) {
  const data = z.object({ category: z.string(), confidence, reason: z.string().max(500).optional() }).parse(extractJson(raw));
  // Kategorie muss exakt (ohne Groß/Klein) aus der Liste stammen – sonst ungültig
  const match = categories.find((c) => c.toLowerCase() === data.category.trim().toLowerCase());
  if (!match) return { category: null, confidence: 0, reason: `Unbekannte Kategorie „${data.category.slice(0, 60)}“` };
  return { category: match, confidence: data.confidence, reason: data.reason };
}

export type ExtractField = { key: string; type: "text" | "number" | "date" | "boolean" };

export function parseExtraction(raw: string, fields: ExtractField[]) {
  const data = z.object({ fields: z.record(z.string(), z.unknown()), confidence, reason: z.string().max(500).optional() }).parse(extractJson(raw));
  const values: Record<string, string | number | boolean | null> = {};
  for (const f of fields) {
    const v = data.fields[f.key];
    if (v === undefined || v === null || v === "") continue;
    if (f.type === "number") {
      const n = Number(v);
      if (Number.isFinite(n)) values[f.key] = n;
    } else if (f.type === "boolean") {
      if (typeof v === "boolean") values[f.key] = v;
      else if (/^(ja|yes|true)$/i.test(String(v))) values[f.key] = true;
      else if (/^(nein|no|false)$/i.test(String(v))) values[f.key] = false;
    } else if (f.type === "date") {
      const d = new Date(String(v));
      if (!Number.isNaN(d.getTime())) values[f.key] = d.toISOString().slice(0, 10);
    } else {
      values[f.key] = String(v).slice(0, 1000);
    }
  }
  return { values, confidence: data.confidence, reason: data.reason };
}

export function parseScore(raw: string) {
  return z
    .object({ points: z.coerce.number().int().min(-20).max(20).catch(0), reason: z.string().max(500).catch("") })
    .parse(extractJson(raw));
}

/** Eingaben für die KI als reine Daten: gekürzt, ohne Steuerzeichen. */
export function asData(v: unknown, max = 2000): string {
  const s = v === null || v === undefined ? "" : typeof v === "string" ? v : JSON.stringify(v);
  return s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, " ").slice(0, max);
}
