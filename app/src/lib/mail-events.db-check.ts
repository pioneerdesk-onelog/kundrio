// DB-Prüfung doppelte Relay-Ereignisse (kein vitest – braucht eine Datenbank):
//   npx tsx --conditions=react-server --env-file=.env src/lib/mail-events.db-check.ts
// Robustheitstest 2026-10-07 (LR-6): Dasselbe Ereignis 10× gleichzeitig (Relay-Wiederholung) ergab 3 EmailEvents
// und 3 Outbox-Ereignisse – die Dublettenprüfung (findFirst → create) war nicht atomar.
// Legt einen eigenen Test-Sub-Account an und löscht ihn am Ende (Cascade). Versendet nichts.
import assert from "node:assert/strict";
import { db } from "./db";
import { applyRelayEvent } from "./mail-events";

async function main() {
  const agency = (await db.agency.findFirst()) ?? (await db.agency.create({ data: { name: "db-check" } }));
  const ws = await db.workspace.create({ data: { agencyId: agency.id, slug: `dbcheck-mailev-${Date.now()}`, name: "db-check Mail-Ereignisse", mailFromEmail: "info@dbcheck.example" } });
  try {
    const contact = await db.contact.create({ data: { workspaceId: ws.id, email: "kunde@dbcheck.example" } });
    const msg = await db.emailMessage.create({
      data: { workspaceId: ws.id, contactId: contact.id, direction: "OUT", fromAddr: "info@dbcheck.example", toAddr: contact.email!, subject: "Test", bodyText: "Test", status: "captured", kind: "campaign" },
    });
    const at = new Date(Math.floor(Date.now() / 1000) * 1000);
    const ev = { event: "hard_bounce", email: contact.email!, messageIdHeader: null, pdId: msg.id, reason: "550 user unknown", link: null, at };
    // Verbindungspool aufwärmen, damit die Zustellungen wirklich gleichzeitig laufen (wie parallele HTTP-Anfragen)
    await Promise.all(Array.from({ length: 10 }, () => db.$queryRaw`SELECT pg_sleep(0.05)::text AS x`));
    const results = await Promise.all(Array.from({ length: 10 }, () => applyRelayEvent({ ...ev })));
    assert.ok(results.every(Boolean), "Alle Zustellungen gelten als angenommen (Relay soll nicht wiederholen)");
    const events = await db.emailEvent.count({ where: { messageId: msg.id, event: "hard_bounce" } });
    const outbox = await db.crmEvent.count({ where: { workspaceId: ws.id, type: "email.event" } });
    const supp = await db.suppression.count({ where: { workspaceId: ws.id } });
    console.log(`EmailEvent: ${events}, Outbox email.event: ${outbox}, Sperrliste: ${supp}`);
    assert.equal(events, 1, "Ereignis genau einmal gespeichert");
    assert.equal(outbox, 1, "Outbox-Ereignis genau einmal");
    assert.equal(supp, 1, "Sperrlisteneintrag genau einmal");
    console.log("✅ Doppelte Relay-Ereignisse werden auch bei gleichzeitiger Zustellung nur einmal übernommen");
  } finally {
    await db.workspace.delete({ where: { id: ws.id } });
  }
}

main()
  .catch((e) => {
    console.error("❌", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
