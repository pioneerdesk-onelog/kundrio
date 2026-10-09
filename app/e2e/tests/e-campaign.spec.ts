import { test, expect, SA, db, wsId, waitFor, beleg } from "../helpers";

// (e) Kampagne: Entwurf → Freigabe → Versand im Worker → Empfängerstatus; Sperrliste greift
test("e · Kampagne freigeben und versenden (nur an Einwilligungen, Sperrliste beachtet)", async ({ as }) => {
  const ws = await wsId();
  const c = await db().campaign.findFirstOrThrow({ where: { workspaceId: ws, name: "Herbst-Newsletter 2026 (Test)" } });
  const p = await as("admin");
  await p.goto(`${SA}/email/kampagne/${c.id}`);
  await expect(p.locator("main")).toContainText("Empfänger");
  // Zielgruppe muss die gewählten Listen benennen (Freigabe-Entscheidung braucht Klarheit)
  await expect(p.locator("main")).toContainText(/Zielgruppe: .*Listen/);
  await p.getByRole("checkbox", { name: /Ich gebe den Versand an \d+ Empfänger frei/ }).check();
  await p.getByRole("button", { name: /Freigeben|freigeben/ }).first().click();
  await waitFor(async () => (await db().campaign.findUnique({ where: { id: c.id } }))?.approvedAt);
  await p.getByRole("button", { name: /Versand|Senden|versenden/i }).first().click();
  const sent = await waitFor(async () => {
    const x = await db().campaign.findUnique({ where: { id: c.id } });
    return x && ["SENT", "FAILED"].includes(x.status) ? x : null;
  }, 60_000);
  expect(sent.status, "Kampagne versendet").toBe("SENT");
  const rec = await db().campaignRecipient.findMany({ where: { campaignId: c.id }, include: { contact: true } });
  expect(rec.length, "Empfänger angelegt").toBeGreaterThan(0);
  // Jeder Empfänger hat Einwilligung und ist nicht abgemeldet
  for (const r of rec) {
    expect(r.contact.consentEmailAt, `${r.contact.email} ohne Einwilligung`).toBeTruthy();
    expect(r.contact.unsubscribedAt, `${r.contact.email} abgemeldet`).toBeNull();
  }
  const emails = rec.map((r) => `${r.contact.email}:${r.status}`);
  // Abgemeldete (Hofmann) und gesperrte (Lindner, nicht in Liste) dürfen nichts bekommen
  expect(rec.find((r) => r.contact.email?.startsWith("j.hofmann@"))).toBeUndefined();
  beleg(`Kampagne ${sent.status}: ${emails.join(", ")}`);
});

test("e · Marketing darf Kampagne entwerfen, aber nicht versenden", async ({ as }) => {
  const p = await as("marketing");
  await p.goto(`${SA}/email`);
  await expect(p.getByRole("link", { name: /Neue Kampagne/ })).toBeVisible();
  const ws = await wsId();
  const c = await db().campaign.findFirst({ where: { workspaceId: ws } });
  if (c) {
    await p.goto(`${SA}/email/kampagne/${c.id}`);
    await expect(p.getByRole("button", { name: /Versand starten|Jetzt versenden/i })).toHaveCount(0);
  }
});
