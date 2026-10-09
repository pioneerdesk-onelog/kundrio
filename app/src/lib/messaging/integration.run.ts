// Integrationstest WhatsApp/SMS gegen LOKALE Mock-Server (kein echter Versand).
//   npx tsx --conditions=react-server --env-file=.env src/lib/messaging/integration.run.ts
import { createServer, type IncomingMessage } from "node:http";
import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";

type Call = { method: string; path: string; headers: IncomingMessage["headers"]; body: string };
const calls: Call[] = [];
const PDF = Buffer.from("%PDF-1.4\n% mock\n");

const server = createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const path = req.url ?? "";
    calls.push({ method: req.method ?? "", path, headers: req.headers, body });
    const json = (code: number, v: unknown) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(v)); };
    if (req.method === "POST" && /^\/v25\.0\/PNID1\/messages$/.test(path)) return json(200, { messaging_product: "whatsapp", messages: [{ id: `wamid.MOCK${calls.length}` }] });
    if (req.method === "GET" && path === "/v25.0/MEDIA1") return json(200, { url: `http://127.0.0.1:${port()}/media/MEDIA1`, mime_type: "application/pdf", file_size: PDF.length });
    if (req.method === "GET" && path === "/media/MEDIA1") { res.writeHead(200, { "content-type": "application/pdf" }); return res.end(PDF); }
    if (req.method === "POST" && path === "/api/sms") return json(200, { success: "100", total_price: 0.075, messages: [{ id: String(77000 + calls.length), success: true, error: null }] });
    json(404, { error: "mock: unknown" });
  });
});
const port = () => (server.address() as AddressInfo).port;

let failures = 0;
function check(name: string, ok: unknown, detail?: unknown) {
  if (ok) console.log(`  ✓ ${name}`);
  else { failures++; console.log(`  ✗ ${name}`, detail ?? ""); }
}

async function main() {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  process.env.WHATSAPP_GRAPH_BASE = `http://127.0.0.1:${port()}/v25.0`;
  process.env.SEVEN_API_BASE = `http://127.0.0.1:${port()}`;
  process.env.MESSAGING_MODE = "live";
  process.env.MESSAGING_LIVE_ALLOWLIST = "+491701110001,+491701110002";

  const { db } = await import("@/lib/db");
  await import("@/lib/messaging/register");
  const { sealCredentials } = await import("@/lib/inbox/credentials");
  const { signMeta, signSeven } = await import("@/lib/messaging/signatures");
  const { handleVerification, handleWebhookPost } = await import("@/lib/messaging/webhook");
  const { handlers } = await import("@/jobs/messaging");
  const { sendChannelMessage, ChannelSendError } = await import("@/lib/messaging/send");
  const { setConsent } = await import("@/lib/messaging/consent");

  const ws = await db.workspace.findFirstOrThrow({ orderBy: { createdAt: "asc" } });
  const TEST_NUMBERS = ["+491701110001", "+491701110002", "+491709990003"];
  const cleanup = async () => {
    await db.inbox.deleteMany({ where: { workspaceId: ws.id, address: { in: ["+4930111000001", "+4930111000002"] } } });
    await db.contact.deleteMany({ where: { workspaceId: ws.id, phone: { in: TEST_NUMBERS } } });
    await db.job.deleteMany({ where: { type: "messaging.webhook", createdAt: { gte: started } } });
  };
  const started = new Date();
  await cleanup();

  const appSecret = randomBytes(16).toString("hex");
  const verifyToken = randomBytes(12).toString("hex");
  const signingSecret = randomBytes(16).toString("hex");
  const wa = await db.inbox.create({ data: { workspaceId: ws.id, name: "Test WhatsApp", kind: "whatsapp", provider: "whatsapp_cloud", address: "+4930111000001", config: { phoneNumberId: "PNID1", wabaId: "WABA1" }, credentials: sealCredentials({ accessToken: "tok-mock", appSecret, verifyToken }) } });
  const sms = await db.inbox.create({ data: { workspaceId: ws.id, name: "Test SMS", kind: "sms", provider: "seven", address: "+4930111000002", config: { senderId: "Test" }, credentials: sealCredentials({ apiKey: "key-mock", signingSecret }) } });
  const base = (process.env.APP_URL ?? "http://127.0.0.1:3100").replace(/\/$/, "");

  // Job aus der Queue ziehen und selbst verarbeiten (unabhängig vom laufenden Worker)
  async function runJobs(inboxId: string) {
    const jobs = await db.job.findMany({ where: { type: "messaging.webhook", createdAt: { gte: started } }, orderBy: { createdAt: "asc" } });
    for (const j of jobs) {
      const p = j.payload as { inboxId: string; parsed: unknown };
      if (p.inboxId !== inboxId) continue;
      await db.job.delete({ where: { id: j.id } }).catch(() => undefined);
      await handlers["messaging.webhook"](p as Record<string, unknown>);
    }
  }
  const waPost = (payload: unknown, secret = appSecret) => {
    const raw = JSON.stringify(payload);
    const req = new Request(`${base}/api/messaging/whatsapp_cloud/${wa.id}`, { method: "POST", headers: { "x-hub-signature-256": signMeta(raw, secret) }, body: raw });
    return handleWebhookPost("whatsapp_cloud", wa.id, req, raw, "127.0.0.9");
  };
  const sevenPost = (payload: unknown, opts: { nonce?: string; secret?: string } = {}) => {
    const raw = JSON.stringify(payload);
    const url = `${base}/api/messaging/seven/${sms.id}`;
    const timestamp = String(Math.floor(Date.now() / 1000));
    const nonce = opts.nonce ?? randomBytes(16).toString("hex");
    const signature = signSeven({ timestamp, nonce, method: "POST", url, body: raw, secret: opts.secret ?? signingSecret });
    const req = new Request(url, { method: "POST", headers: { "x-signature": signature, "x-timestamp": timestamp, "x-nonce": nonce }, body: raw });
    return handleWebhookPost("seven", sms.id, req, raw, "127.0.0.9");
  };
  const waValue = (extra: Record<string, unknown>) => ({ object: "whatsapp_business_account", entry: [{ id: "WABA1", changes: [{ field: "messages", value: { messaging_product: "whatsapp", metadata: { display_phone_number: "4930111000001", phone_number_id: "PNID1" }, ...extra } }] }] });
  const ts = () => String(Math.floor(Date.now() / 1000));

  try {
    console.log("WhatsApp");
    const v = await handleVerification("whatsapp_cloud", wa.id, new URL(`${base}/x?hub.mode=subscribe&hub.verify_token=${verifyToken}&hub.challenge=12345`));
    check("Webhook-Verifizierung (GET) liefert challenge", v.status === 200 && v.body === "12345", v);
    const vBad = await handleVerification("whatsapp_cloud", wa.id, new URL(`${base}/x?hub.mode=subscribe&hub.verify_token=falsch&hub.challenge=1`));
    check("falscher Verify-Token → 403", vBad.status === 403);
    const bad = await waPost(waValue({ messages: [] }), "falsch");
    check("falsche Signatur → 401", bad.status === 401, bad);

    const r1 = await waPost(waValue({ contacts: [{ profile: { name: "Anna Test" }, wa_id: "491701110001" }], messages: [{ from: "491701110001", id: "wamid.IN1", timestamp: ts(), type: "text", text: { body: "Hallo, habt ihr morgen Zeit?" } }] }));
    check("eingehende Nachricht angenommen", r1.status === 200, r1);
    await runJobs(wa.id);
    const anna = await db.contact.findFirst({ where: { workspaceId: ws.id, phone: "+491701110001" } });
    check("Kontakt automatisch angelegt", anna, anna);
    const conv = await db.conversation.findFirst({ where: { inboxId: wa.id, threadKey: "+491701110001" }, include: { messages: true } });
    check("Gespräch + Nachricht im Posteingang", conv && conv.messages.some((m) => m.direction === "in" && m.bodyText?.includes("morgen Zeit")), conv);

    await waPost(waValue({ messages: [{ from: "491701110001", id: "wamid.IN1", timestamp: ts(), type: "text", text: { body: "Hallo, habt ihr morgen Zeit?" } }] }));
    await runJobs(wa.id);
    check("doppelter Webhook wird nicht doppelt gespeichert", (await db.message.count({ where: { externalId: "wamid.IN1" } })) === 1);

    await waPost(waValue({ messages: [{ from: "491701110001", id: "wamid.IN2", timestamp: ts(), type: "document", document: { id: "MEDIA1", mime_type: "application/pdf", filename: "angebot.pdf" } }] }));
    await runJobs(wa.id);
    check("Medien-Download über Graph-API (Mock)", calls.some((c) => c.path === "/media/MEDIA1" && c.headers.authorization === "Bearer tok-mock"));

    const before = calls.length;
    const sent = await sendChannelMessage(ws.id, { contactId: anna!.id, kind: "whatsapp", text: "Ja, 10 Uhr passt.", purpose: "transactional" }, "test");
    const waCall = calls.slice(before).find((c) => c.path === "/v25.0/PNID1/messages");
    check("Antwort im 24-h-Fenster an Graph-API gesendet", waCall && JSON.parse(waCall.body).to === "+491701110001" && waCall.headers.authorization === "Bearer tok-mock", waCall);
    const outMsg = await db.message.findFirst({ where: { conversation: { inboxId: wa.id }, direction: "out", bodyText: "Ja, 10 Uhr passt." } });
    check("ausgehende Nachricht gespeichert (queued, Status folgt per Webhook)", outMsg?.status === "queued" && outMsg.externalId?.startsWith("wamid.MOCK"), { sent, outMsg });

    let mk = false;
    try { await sendChannelMessage(ws.id, { contactId: anna!.id, kind: "whatsapp", text: "Neues Angebot!", purpose: "marketing" }, "test"); } catch (e) { mk = e instanceof ChannelSendError && e.code === "no_consent"; }
    check("Werbung ohne Einwilligung blockiert (§ 7 UWG)", mk);

    await waPost(waValue({ statuses: [{ id: outMsg!.externalId, status: "read", timestamp: ts(), recipient_id: "491701110001" }] }));
    await runJobs(wa.id);
    await waPost(waValue({ statuses: [{ id: outMsg!.externalId, status: "delivered", timestamp: ts(), recipient_id: "491701110001" }] }));
    await runJobs(wa.id);
    const afterStatus = await db.message.findUnique({ where: { id: outMsg!.id } });
    check("Status read, späteres delivered stuft nicht herab", afterStatus?.status === "read", afterStatus?.status);

    // Kontakt außerhalb der Freigabeliste → nur Testmodus
    const other = await db.contact.create({ data: { workspaceId: ws.id, firstName: "Nicht", lastName: "Freigegeben", phone: "+491709990003" } });
    await setConsent(ws.id, other.id, "whatsapp", true, "Test-Einwilligung (Integrationstest)", "test");
    const before2 = calls.length;
    await sendChannelMessage(ws.id, { contactId: other.id, kind: "whatsapp", template: { name: "termin_erinnerung", language: "de", params: ["Nicht"] }, purpose: "marketing" }, "test");
    const capt = await db.message.findFirst({ where: { toAddrs: { has: "+491709990003" }, direction: "out" } });
    check("Nummer nicht auf Freigabeliste → captured, kein Aufruf", calls.length === before2 && capt?.status === "captured", { calls: calls.length - before2, status: capt?.status });

    await waPost(waValue({ messages: [{ from: "491701110001", id: "wamid.STOP1", timestamp: ts(), type: "text", text: { body: "STOP" } }] }));
    await runJobs(wa.id);
    await waPost(waValue({ messages: [{ from: "491701110001", id: "wamid.STOP1", timestamp: ts(), type: "text", text: { body: "STOP" } }] }));
    await runJobs(wa.id);
    const annaAfter = await db.contact.findUnique({ where: { id: anna!.id } });
    check("STOP → Abmeldung gespeichert", annaAfter?.whatsappOptOutAt != null);
    const confirms = await db.message.count({ where: { conversation: { inboxId: wa.id }, direction: "out", bodyText: { contains: "keine weiteren Nachrichten" } } });
    check("Bestätigung genau einmal gesendet", confirms === 1, confirms);
    let blocked = false;
    try { await sendChannelMessage(ws.id, { contactId: anna!.id, kind: "whatsapp", text: "Noch eine Frage", purpose: "transactional" }, "test"); } catch (e) { blocked = e instanceof ChannelSendError && e.code === "opted_out"; }
    check("nach STOP kein Versand mehr", blocked);

    console.log("SMS (seven.io)");
    const s1 = await sevenPost({ data: { id: "900001", sender: "491701110002", system: "4930111000002", text: "Bitte Rückruf", time: ts() }, webhook_event: "sms_mo", webhook_timestamp: "2026-10-07 12:00:00" }, { nonce: "n".repeat(32) });
    check("eingehende SMS angenommen", s1.status === 200, s1);
    const replay = await sevenPost({ data: { id: "900001", sender: "491701110002", system: "4930111000002", text: "Bitte Rückruf", time: ts() }, webhook_event: "sms_mo" }, { nonce: "n".repeat(32) });
    check("gleiche Nonce erneut → 409 (Replay-Schutz)", replay.status === 409, replay);
    const sBad = await sevenPost({ data: {} }, { secret: "falsch" });
    check("falsche Signatur → 401", sBad.status === 401, sBad);
    await runJobs(sms.id);
    const ben = await db.contact.findFirst({ where: { workspaceId: ws.id, phone: "+491701110002" } });
    check("SMS-Kontakt angelegt und Gespräch vorhanden", ben && (await db.conversation.count({ where: { inboxId: sms.id, contactId: ben.id } })) === 1);

    const before3 = calls.length;
    await sendChannelMessage(ws.id, { contactId: ben!.id, kind: "sms", text: "Wir rufen heute an.", purpose: "transactional" }, "test");
    const smsCall = calls.slice(before3).find((c) => c.path === "/api/sms");
    check("SMS an seven-Mock gesendet (X-Api-Key, Absender)", smsCall && smsCall.headers["x-api-key"] === "key-mock" && JSON.parse(smsCall.body).from === "Test", smsCall?.body);
    const smsOut = await db.message.findFirst({ where: { conversation: { inboxId: sms.id }, direction: "out" } });
    await sevenPost({ data: { msg_id: smsOut!.externalId!.replace("seven:", ""), status: "DELIVERED", timestamp: "2026-10-07 12:01:00" }, webhook_event: "dlr" });
    await runJobs(sms.id);
    check("Zustellbericht → delivered", (await db.message.findUnique({ where: { id: smsOut!.id } }))?.status === "delivered");

    await sevenPost({ data: { id: "900002", sender: "491701110002", system: "4930111000002", text: "ABMELDEN", time: ts() }, webhook_event: "sms_mo" });
    await runJobs(sms.id);
    const benAfter = await db.contact.findUnique({ where: { id: ben!.id } });
    check("SMS-ABMELDEN → Abmeldung im Kontakt", Boolean((benAfter?.attributes as Record<string, unknown> | null)?.SMS_OPT_OUT_AT));
  } finally {
    await cleanup();
    server.close();
    await db.$disconnect();
  }
  console.log(failures ? `\n${failures} Prüfung(en) fehlgeschlagen` : "\nAlle Prüfungen bestanden");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
