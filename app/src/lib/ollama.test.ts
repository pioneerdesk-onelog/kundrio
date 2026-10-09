import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { chat, embed } from "./ollama";

// Robustheitstest 2026-10-07 (LR-5): Nimmt Ollama Verbindungen an, antwortet aber nicht (überlastet, Modell lädt,
// Netzproblem), hingen Anfragen bis zum undici-Standard von 300 s – Agent-API 301 s bis zur Fehlermeldung,
// ein Worker-Job blockierte die Warteschlange 5 min je Versuch. Erwartung: eigenes Zeitlimit mit klarer Meldung.

let server: Server;
const env = { ...process.env };

beforeAll(async () => {
  server = createServer(() => {
    /* nimmt an, antwortet nie */
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  process.env.OLLAMA_BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.OLLAMA_EMBED_TIMEOUT_MS = "300";
  process.env.OLLAMA_CHAT_TIMEOUT_MS = "300";
});

afterAll(async () => {
  process.env = env;
  server.closeAllConnections();
  await new Promise<void>((r) => server.close(() => r()));
});

describe("Ollama-Zeitlimit", () => {
  it("Embedding bricht nach dem Zeitlimit mit verständlicher Meldung ab", async () => {
    const t = Date.now();
    await expect(embed(["hallo"])).rejects.toThrow(/Ollama antwortet nicht/);
    expect(Date.now() - t).toBeLessThan(3000);
  });

  it("Chat bricht nach dem Zeitlimit mit verständlicher Meldung ab", async () => {
    const t = Date.now();
    await expect(chat([{ role: "user", content: "hallo" }])).rejects.toThrow(/Ollama antwortet nicht/);
    expect(Date.now() - t).toBeLessThan(3000);
  });
});
