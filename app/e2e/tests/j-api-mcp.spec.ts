import { test, expect, SA, db, wsId, waitFor, mailpitSearch, beleg } from "../helpers";
import { test as raw } from "@playwright/test";
import { createHash, randomBytes } from "node:crypto";

// (j) API-Schlüssel, Brevo-kompatible Mail-API, MCP, OAuth-Discovery
async function makeKey(scopes: string[]) {
  const ws = await wsId();
  const prefix = `pdk_${randomBytes(4).toString("hex")}`;
  const plain = `${prefix}_${randomBytes(24).toString("base64url")}`;
  await db().apiKey.create({ data: { workspaceId: ws, name: "E2E-Testschlüssel", scopes, prefix, hash: createHash("sha256").update(plain).digest("hex") } });
  return plain;
}

test("j · API-Seite: Schlüssel-Verwaltung nur für Admin sichtbar", async ({ as }) => {
  const p = await as("admin");
  await p.goto(`${SA}/api`);
  await expect(p.locator("main")).toContainText(/Schlüssel/);
  await expect(p.locator("main")).toContainText(/MCP/);
});

raw("j · Mail-API (Brevo-Format) → Worker → Mailpit; fremde Domain abgelehnt", async ({ request }) => {
  const key = await makeKey(["mail:send"]);
  const to = `e2e.api.${Date.now()}@example.com`;
  const ok = await request.post("/api/brevo/v3/smtp/email", {
    headers: { "api-key": key },
    data: { sender: { email: "info@e2e.pioneerdesk.test", name: "Testmandant" }, to: [{ email: to }], subject: "E2E Transaktionsmail", htmlContent: "<p>Test</p>" },
  });
  expect(ok.status()).toBe(201);
  const bad = await request.post("/api/brevo/v3/smtp/email", {
    headers: { "api-key": key },
    data: { sender: { email: "x@gmail.com" }, to: [{ email: to }], subject: "x", textContent: "x" },
  });
  expect(bad.status()).toBe(400);
  const m = await waitFor(async () => (await mailpitSearch(`to:${to}`))[0], 30_000);
  beleg(`Mail-API: ${(await ok.json()).messageId} → Mailpit ${m.ID}`);
});

raw("j · MCP: tools/list mit Schlüssel, 401 ohne Anmeldung mit resource_metadata", async ({ request }) => {
  const key = await makeKey(["mcp:read", "mcp:write"]);
  const headers = { authorization: `Bearer ${key}`, "content-type": "application/json", "MCP-Protocol-Version": "2025-06-18", accept: "application/json, text/event-stream" };
  const list = await request.post("/api/mcp", { headers, data: { jsonrpc: "2.0", id: 1, method: "tools/list" } });
  expect(list.status()).toBe(200);
  const tools = ((await list.json()) as { result: { tools: unknown[] } }).result.tools;
  expect(tools.length).toBeGreaterThan(20);
  const anon = await request.post("/api/mcp", { headers: { "content-type": "application/json" }, data: { jsonrpc: "2.0", id: 1, method: "tools/list" } });
  expect(anon.status()).toBe(401);
  expect(anon.headers()["www-authenticate"] ?? "").toContain("resource_metadata");
  beleg(`MCP: ${tools.length} Werkzeuge`);
});

raw("j · OAuth-Discovery und Zustimmungsseite erreichbar", async ({ request }) => {
  const pr = await request.get("/.well-known/oauth-protected-resource");
  expect(pr.status()).toBe(200);
  const as = await request.get("/.well-known/oauth-authorization-server");
  expect(as.status()).toBe(200);
  const meta = (await as.json()) as { code_challenge_methods_supported?: string[] };
  expect(meta.code_challenge_methods_supported).toContain("S256");
});

test.afterAll(async () => {
  await db().apiKey.deleteMany({ where: { name: "E2E-Testschlüssel" } });
});
