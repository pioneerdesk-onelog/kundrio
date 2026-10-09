/**
 * Integrationstest Posteingang gegen die lokale Datenbank (kein IMAP-Server nötig):
 * RFC-822-Fixtures → Ingest → Thread-Zuordnung, Dubletten, Auto-Reply, Spam, Kontaktzuordnung;
 * Antwort über den SMTP-Weg der Inbox (MAIL_MODE=capture → landet in Mailpit, nie extern).
 * Aufruf: npx tsx --conditions=react-server --env-file=.env src/lib/inbox/ingest.integration.ts
 * Legt einen Wegwerf-Sub-Account an und löscht ihn am Ende wieder.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { parseRawEmail } from "./channels/email-parse";
import { ingestInbound } from "./ingest";
import { addNote, replyToConversation } from "./send";
import { sealCredentials } from "./credentials";
import { deleteStoredFile } from "@/lib/storage";

const fx = (n: string) => readFileSync(path.join(__dirname, "__fixtures__", n));
const tag = `inbox-it-${Date.now()}`;

async function main() {
  assert.equal(env.mailMode(), "capture", "Integrationstest nur im capture-Modus");
  const agency = await db.agency.findFirstOrThrow();
  const user = await db.user.findFirstOrThrow({ where: { active: true, agencyRole: { in: ["owner", "admin"] } } });
  const ws = await db.workspace.create({ data: { agencyId: agency.id, slug: tag, name: "Posteingang-Test" } });
  try {
    const inbox = await db.inbox.create({
      data: {
        workspaceId: ws.id, name: "Support", kind: "email", provider: "imap", address: "support@agentur.example",
        config: { imapHost: "127.0.0.1", imapUser: "x", smtpHost: "127.0.0.1", smtpPort: 51025, smtpUser: "x", signature: "-- \nIhr Support-Team", assignment: "round_robin", assigneeIds: [user.id] },
        credentials: sealCredentials({ imapPassword: "test", smtpPassword: "test" }),
      },
    });
    // bestehender Kontakt (Groß/Klein egal) wird zugeordnet
    const existing = await db.contact.create({ data: { workspaceId: ws.id, email: "Erika@Kunde.example", firstName: "Erika" } });

    const reply = await parseRawEmail(fx("reply.eml"));
    const r1 = await ingestInbound(inbox.id, [reply]);
    assert.equal(r1.created, 1);
    const conv = await db.conversation.findFirstOrThrow({ where: { inboxId: inbox.id }, include: { messages: true } });
    assert.equal(conv.contactId, existing.id, "Kontakt per E-Mail zugeordnet");
    assert.equal(conv.assigneeId, user.id, "Rundlauf weist zu");
    assert.equal(conv.unread, 1);
    assert.equal(conv.threadKey, "<orig-1@agentur.example>");
    const msg = conv.messages[0];
    assert.equal((msg.attachments as unknown[]).length, 1, "Anhang gespeichert");

    // Dublette (gleiche Message-ID) wird übersprungen
    const r2 = await ingestInbound(inbox.id, [reply]);
    assert.equal(r2.duplicates, 1);

    // Folgemail im selben Thread → selbes Gespräch
    const follow = await parseRawEmail(
      `From: erika@kunde.example\r\nTo: support@agentur.example\r\nSubject: AW: AW: Ihr Angebot\r\nMessage-ID: <reply-2@kunde.example>\r\nIn-Reply-To: <reply-1@kunde.example>\r\nReferences: <orig-1@agentur.example> <reply-1@kunde.example>\r\n\r\nNoch eine Frage.`,
    );
    await ingestInbound(inbox.id, [follow]);
    assert.equal(await db.conversation.count({ where: { inboxId: inbox.id } }), 1, "gleicher Thread");

    // Abwesenheitsnotiz: kein neuer Kontakt, ungelesen nicht erhöht, kein Ereignis
    const ooo = await parseRawEmail(fx("autoreply.eml"));
    const r3 = await ingestInbound(inbox.id, [ooo]);
    assert.equal(r3.autoReplies, 1);
    assert.equal(await db.contact.count({ where: { workspaceId: ws.id, email: "max@kunde.example" } }), 0);

    // Spam: Gespräch geschlossen, kein Kontakt
    const spam = await parseRawEmail(`From: win@lotto.example\r\nTo: support@agentur.example\r\nSubject: Gewinn!\r\nMessage-ID: <s1@lotto.example>\r\nX-Spam-Flag: YES\r\n\r\nKlick hier`);
    const r4 = await ingestInbound(inbox.id, [spam]);
    assert.equal(r4.spam, 1);
    const spamConv = await db.conversation.findFirstOrThrow({ where: { inboxId: inbox.id, tags: { has: "spam" } } });
    assert.equal(spamConv.status, "closed");
    assert.equal(spamConv.contactId, null);

    // Unbekannter Absender → neuer Kontakt mit Name
    const fresh = await parseRawEmail(`From: "Jonas Neu" <jonas@neu.example>\r\nTo: support@agentur.example\r\nSubject: Anfrage\r\nMessage-ID: <n1@neu.example>\r\n\r\nHallo`);
    await ingestInbound(inbox.id, [fresh]);
    const jonas = await db.contact.findFirstOrThrow({ where: { workspaceId: ws.id, email: "jonas@neu.example" } });
    assert.equal(jonas.firstName, "Jonas");
    assert.equal(jonas.lastName, "Neu");

    // Ereignis für Prozesse
    const events = await db.crmEvent.count({ where: { workspaceId: ws.id, type: "conversation.message_received" } });
    assert.equal(events, 3, "Ereignis für echte Nachrichten (nicht Dublette/Auto-Reply/Spam)");

    // Antwort → Mailpit (capture), mit Thread-Headern und Signatur
    await replyToConversation(ws.id, conv.id, user.id, { text: `Gern, Rechnung folgt. ${tag}` });
    const out = await db.message.findFirstOrThrow({ where: { conversationId: conv.id, direction: "out" } });
    assert.ok(["sent", "captured"].includes(out.status), out.error ?? out.status);
    assert.equal(out.inReplyTo, "<reply-2@kunde.example>");
    assert.ok(out.bodyText.includes("Ihr Support-Team"), "Signatur angehängt");
    const after = await db.conversation.findUniqueOrThrow({ where: { id: conv.id } });
    assert.equal(after.unread, 0);
    assert.equal(after.status, "pending");
    const mp = (await (await fetch(`http://127.0.0.1:58025/api/v1/search?query=${encodeURIComponent(tag)}`)).json()) as { messages: { To: { Address: string }[] }[] };
    assert.ok(mp.messages.length >= 1, "in Mailpit angekommen");
    assert.equal(mp.messages[0].To[0].Address, "erika@kunde.example");

    await addNote(ws.id, conv.id, user.id, "Intern: Rabatt geprüft");
    assert.equal(await db.message.count({ where: { conversationId: conv.id, direction: "note" } }), 1);
    console.log("Posteingang-Integrationstest: alle Prüfungen bestanden");
  } finally {
    for (const f of await db.storedFile.findMany({ where: { workspaceId: ws.id }, select: { id: true } })) await deleteStoredFile(ws.id, f.id).catch(() => {});
    await db.workspace.delete({ where: { id: ws.id } });
    await db.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
