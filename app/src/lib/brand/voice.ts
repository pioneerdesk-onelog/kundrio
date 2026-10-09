import "server-only";
import { db } from "../db";
import { parseGuide } from "./guide";
import { voiceFromGuide } from "./voice-text";

export { voiceFromGuide } from "./voice-text";

// Markenstimme als zusätzlicher Systemhinweis für KI-Texte (Landingpages, Übersetzung, Wiki).
// Nur Stil – Fakten kommen weiterhin ausschließlich aus den Quellen.

/** Systemhinweis zur Markenstimme oder null, wenn kein Leitfaden gepflegt ist. */
export async function brandVoicePrompt(workspaceId: string): Promise<string | null> {
  const ws = await db.workspace.findUnique({ where: { id: workspaceId }, select: { brandGuide: true } });
  return ws?.brandGuide ? voiceFromGuide(parseGuide(ws.brandGuide)) : null;
}
