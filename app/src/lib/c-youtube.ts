import "server-only";
import { syncAccount } from "./channels/sync";

// Kompatibilitäts-Schicht: YouTube läuft jetzt über den Konnektor-Rahmen (src/lib/channels).

export function youtubeConfigured(): boolean {
  return Boolean(process.env.YOUTUBE_API_KEY);
}

export async function syncYoutube(accountId: string, workspaceId: string) {
  const r = await syncAccount(accountId, workspaceId);
  if (!r.ok) throw new Error(r.message);
  return r.metrics;
}
