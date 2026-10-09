import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { chatDetailed, embedDetailed } from "./ollama";
import { validateProductionEnv } from "./env";
import { externalConnections } from "./compliance-connections";

// Betrieb auf STACKIT (2026-10-09): Die App sprach nur das Ollama-Protokoll; STACKIT AI Model Serving ist
// OpenAI-kompatibel. Erwartung: AI_PROVIDER=openai nutzt /embeddings und /chat/completions mit Bearer-Schlüssel.

let server: Server;
const seen: { path?: string; auth?: string; body: Record<string, unknown> }[] = [];
const env = { ...process.env };

const read = (req: IncomingMessage) => new Promise<string>((r) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => r(b)); });

beforeAll(async () => {
  server = createServer(async (req, res) => {
    const body = JSON.parse(await read(req));
    seen.push({ path: req.url, auth: req.headers.authorization, body });
    res.setHeader("content-type", "application/json");
    if (req.url === "/v1/embeddings") {
      const data = (body.input as string[]).map((_, i) => ({ index: i, embedding: Array(1024).fill(i) })).reverse();
      res.end(JSON.stringify({ data, usage: { prompt_tokens: 7 } }));
    } else {
      res.end(JSON.stringify({ choices: [{ message: { content: "<think>x</think> Hallo" } }], usage: { prompt_tokens: 3, completion_tokens: 2 } }));
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  process.env.AI_PROVIDER = "openai";
  process.env.AI_BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/`;
  process.env.AI_API_KEY = "test-key";
  process.env.EMBED_DIM = "1024";
});

afterAll(async () => {
  process.env = env;
  await new Promise<void>((r) => server.close(() => r()));
});

describe("OpenAI-kompatibler KI-Dienst", () => {
  it("Embeddings in Eingabereihenfolge, mit Dimension und Schlüssel", async () => {
    const r = await embedDetailed(["a", "b"]);
    expect(r.embeddings.map((e) => e[0])).toEqual([0, 1]);
    expect(r.tokensIn).toBe(7);
    expect(seen.at(-1)).toMatchObject({ path: "/v1/embeddings", auth: "Bearer test-key", body: { dimensions: 1024 } });
  });

  it("Chat über /chat/completions, Denkblock entfernt, Tokens gezählt", async () => {
    const r = await chatDetailed([{ role: "user", content: "hi" }]);
    expect(r).toEqual({ content: "Hallo", tokensIn: 3, tokensOut: 2 });
    expect(seen.at(-1)).toMatchObject({ path: "/v1/chat/completions", body: { chat_template_kwargs: { enable_thinking: false } } });
  });

  it("Produktionsprüfung verlangt https-Adresse und Schlüssel", () => {
    const base = { DATABASE_URL: "x", APP_SECRET: "a".repeat(40), APP_URL: "https://app.example", MAIL_EVENTS_SECRET: "b".repeat(30), TRUST_PROXY: "1", AI_PROVIDER: "openai", NODE_ENV: "production" as const };
    expect(validateProductionEnv(base)).toEqual(expect.arrayContaining([expect.stringMatching(/AI_BASE_URL/), expect.stringMatching(/AI_API_KEY/)]));
    expect(validateProductionEnv({ ...base, AI_BASE_URL: "https://api.openai-compat.model-serving.eu01.onstackit.cloud/v1", AI_API_KEY: "k" })).toEqual([]);
  });

  it("Souveränitäts-Cockpit: STACKIT EU01 gilt als DE, fremder Dienst als ungeprüft", () => {
    const ai = (u: string) => externalConnections({ AI_PROVIDER: "openai", AI_BASE_URL: u }).find((c) => c.id === "ollama")!;
    expect(ai("https://api.openai-compat.model-serving.eu01.onstackit.cloud/v1")).toMatchObject({ regions: ["DE", "EU"], provider: "STACKIT AI Model Serving" });
    expect(ai("https://api.example.com/v1").regions).toEqual([]);
  });
});
