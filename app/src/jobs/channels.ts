import type { JobHandler } from "@/lib/jobs";
import { enqueue } from "@/lib/jobs";
import { db } from "@/lib/db";
import { platformInfo, supportsApi } from "@/lib/channels/config";
import { REAUTH_PREFIX, syncAccount } from "@/lib/channels/sync";
import type { Platform } from "@/lib/channels/types";

// Täglicher Abruf aller per Schnittstelle angebundenen Kanäle (05:00 UTC) + Einzelabruf.
// Kanäle mit Status „neu verbinden“ werden übersprungen, bis jemand neu verbindet (keine Endlosschleifen).

function nextRun() {
  const n = new Date();
  n.setUTCDate(n.getUTCDate() + (n.getUTCHours() >= 5 ? 1 : 0));
  n.setUTCHours(5, 0, 0, 0);
  return n;
}

export async function ensureChannelsScheduled() {
  const pending = await db.job.count({ where: { type: "channels.sync", status: "queued" } });
  if (pending === 0) await enqueue("channels.sync", {}, { runAt: nextRun() });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const handlers: Record<string, JobHandler> = {
  "channels.sync": async () => {
    const accounts = await db.channelAccount.findMany({ select: { id: true, platform: true, connection: true, lastError: true, credentials: true } });
    let ok = 0;
    let skipped = 0;
    for (const a of accounts) {
      const p = a.platform as Platform;
      const info = platformInfo(p);
      const eligible = supportsApi(p) && info.configured && (info.mode === "key" ? a.connection === "api" || p === "youtube" : Boolean(a.credentials));
      if (!eligible || a.lastError?.startsWith(REAUTH_PREFIX)) {
        skipped++;
        continue;
      }
      try {
        const r = await syncAccount(a.id);
        if (r.ok) ok++;
      } catch {
        // vorübergehender Fehler steht am Kanal; nächster Tageslauf versucht es erneut
      }
      await sleep(1500); // Drosselung zwischen Plattform-Aufrufen
    }
    console.log(`channels.sync: ${ok} abgerufen, ${skipped} übersprungen`);
    await ensureChannelsScheduled();
  },
  "channels.syncOne": async (p) => {
    // wirft nur bei vorübergehenden Fehlern → Job-Wiederholung mit Backoff
    await syncAccount(String(p.accountId), p.workspaceId ? String(p.workspaceId) : undefined);
  },
};

export const onWorkerStart = ensureChannelsScheduled;
