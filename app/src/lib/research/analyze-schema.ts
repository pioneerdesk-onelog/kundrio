import { z } from "zod";
import { TOPICS } from "./types";

// Schema und Parser der KI-Auswertung (rein, testbar).

export const analysisSchema = z.object({
  aboutEntity: z.boolean(),
  confidence: z.number().min(0).max(1),
  summary: z.string().trim().min(1).max(600),
  sentiment: z.enum(["positiv", "neutral", "negativ"]),
  relevance: z.number().min(0).max(1),
  topics: z.array(z.enum(TOPICS)).max(4),
});
export type Analysis = z.infer<typeof analysisSchema>;

/** JSON aus Modellantwort lösen (Codeblöcke/Vortext tolerieren), dann prüfen. */
export function parseAnalysis(text: string): Analysis | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    const raw = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
    // tolerant: unbekannte Themen verwerfen statt ganze Antwort abzulehnen
    if (Array.isArray(raw.topics)) raw.topics = raw.topics.filter((t) => (TOPICS as readonly string[]).includes(String(t))).slice(0, 4);
    const r = analysisSchema.safeParse(raw);
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}
