import { test, expect, SA, db, wsId, beleg, waitFor, mailpitSearch, expectDenied, canRead } from "../helpers";

// (q) Gemeinsamer Posteingang: Gespräch lesen (HTML bereinigt, Bilder blockiert), antworten (→ Mailpit),
// interne Notiz, zuweisen, per Tastenkürzel erledigen, in Ticket umwandeln; Rechte.
const stamp = Date.now().toString(36);

async function seedConversation() {
  const ws = await wsId();
  const inbox = await db().inbox.upsert({
    where: { workspaceId_kind_address: { workspaceId: ws, kind: "email", address: "e2e-support@pioneerdesk.example" } },
    update: { active: true, status: "ok" },
    // keine Zugangsdaten: Abruf schlägt nur am Postfach fehl (lastError); Versand im capture-Modus über Mailpit.
    // Aktiv anlegen – ein deaktivierter Posteingang verweigert Antworten (gewollt).
    create: { workspaceId: ws, name: "E2E-Support", kind: "email", provider: "imap", address: "e2e-support@pioneerdesk.example", active: true, config: { imapHost: "127.0.0.1", imapUser: "x", smtpHost: "127.0.0.1", smtpUser: "x" } },
  });
  const contact = await db().contact.create({ data: { workspaceId: ws, email: `inbox-${stamp}@kunde.example`, firstName: "Ines", lastName: `Box-${stamp}` } });
  const conv = await db().conversation.create({
    data: {
      workspaceId: ws, inboxId: inbox.id, contactId: contact.id, subject: `Frage ${stamp}`, threadKey: `<q-${stamp}@kunde.example>`, unread: 1,
      messages: {
        create: {
          workspaceId: ws, direction: "in", channel: "email", fromAddr: contact.email, toAddrs: [inbox.address], subject: `Frage ${stamp}`,
          bodyText: `Hallo, wann kommt die Lieferung? ${stamp}`, externalId: `<q-${stamp}@kunde.example>`,
          bodyHtml: `<p>Hallo, wann kommt die <b>Lieferung</b>?</p><script>window.__pwned=1</script><img src="https://tracker.example/p.gif" width="1" height="1"><img src="https://cdn.example/logo.png">`,
        },
      },
    },
  });
  return { ws, inbox, contact, conv };
}

test("q · Gespräch lesen, antworten, Notiz, zuweisen, erledigen, Ticket", async ({ as }) => {
  const { ws, contact, conv } = await seedConversation();
  const p = await as("admin");
  await p.goto(`${SA}/posteingang?c=${conv.id}&s=alle`);
  await expect(p.getByRole("heading", { name: `Frage ${stamp}` })).toBeVisible();
  // HTML nur im abgeschotteten iframe; Skript nicht ausgeführt, Zählpixel entfernt, Bild blockiert
  const frame = p.frameLocator('iframe[title="Nachrichteninhalt"]');
  await expect(frame.locator("b")).toHaveText("Lieferung");
  expect(await p.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
  await expect(p.locator("main")).toContainText("1 Zählpixel entfernt");
  await expect(p.getByRole("link", { name: "Bilder laden" })).toBeVisible();
  // gelesen markiert
  await waitFor(async () => (await db().conversation.findUnique({ where: { id: conv.id } }))?.unread === 0);

  // Antwort → Mailpit
  await p.keyboard.press("r");
  await p.getByLabel("Antworttext").fill(`Morgen früh. ${stamp}`);
  await p.getByRole("button", { name: "Senden" }).click();
  await expect(p.getByRole("status")).toContainText("Gesendet");
  const mails = await waitFor(async () => {
    const m = await mailpitSearch(`Morgen früh. ${stamp}`);
    return m.length ? m : null;
  });
  expect(mails[0].To[0].Address).toBe(contact.email);
  const out = await db().message.findFirstOrThrow({ where: { conversationId: conv.id, direction: "out" } });
  // capture-Modus: nur an Mailpit umgeleitet → Status „captured“ (Testmodus)
  expect(["sent", "captured"]).toContain(out.status);
  expect(out.inReplyTo).toBe(`<q-${stamp}@kunde.example>`);

  // interne Notiz
  await p.getByRole("tab", { name: "Interne Notiz" }).click();
  await p.getByLabel("Notiz").fill(`Nur intern ${stamp}`);
  await p.getByRole("button", { name: "Notiz speichern" }).click();
  await waitFor(() => db().message.findFirst({ where: { conversationId: conv.id, direction: "note" } }));
  expect(await mailpitSearch(`Nur intern ${stamp}`)).toHaveLength(0);

  // zuweisen
  const admin = await db().user.findFirstOrThrow({ where: { memberships: { some: { workspaceId: ws } } }, orderBy: { createdAt: "asc" } });
  await p.getByLabel("Zuständig").selectOption(admin.id);
  await p.getByLabel("Zuständig").locator("..").getByRole("button", { name: "OK" }).click();
  await waitFor(async () => (await db().conversation.findUnique({ where: { id: conv.id } }))?.assigneeId === admin.id);

  // in Ticket umwandeln
  await p.getByRole("button", { name: "In Ticket umwandeln" }).click();
  await expect(p.locator("main")).toContainText("angelegt");
  const withTicket = await waitFor(() => db().conversation.findFirst({ where: { id: conv.id, ticketId: { not: null } } }));
  beleg(`Ticket ${withTicket.ticketId}`);

  // e = erledigt
  await p.locator("body").click({ position: { x: 5, y: 5 } });
  await p.keyboard.press("e");
  await waitFor(async () => (await db().conversation.findUnique({ where: { id: conv.id } }))?.status === "closed");
  beleg(`Gespräch ${conv.id}`);
});

test("q · Einstellungen nur mit Schlüssel-Recht, Lesen nur mit E-Mail-Recht", async ({ as }) => {
  const p = await as("admin");
  await p.goto(`${SA}/posteingang/einstellungen`);
  await expect(p.getByRole("heading", { name: "Posteingang – Kanäle" })).toBeVisible();
  await expect(p.locator("main")).toContainText("E2E-Support");
  // Passwort wird nie angezeigt
  await expect(p.locator('input[name="imapPassword"]')).toHaveValue("");

  const ro = await as("nurlesen");
  if (!canRead("nurlesen", "email")) await expectDenied(ro, `${SA}/posteingang`);
  else {
    await ro.goto(`${SA}/posteingang`);
    await expect(ro.getByRole("button", { name: "Senden" })).toHaveCount(0);
  }
  await expectDenied(ro, `${SA}/posteingang/einstellungen`);
});
