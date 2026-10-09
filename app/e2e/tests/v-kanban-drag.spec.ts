import { test, expect, SA, db, wsId } from "../helpers";

// (v) Pipeline: Karte mit der Maus in die nächste Phase ziehen → Phase ist gespeichert (auch nach Neuladen).
// Regression: Ziehen bewegte die Karte sichtbar, speicherte aber nicht.
const stamp = Date.now().toString(36);

test("v · Kanban: Ziehen mit der Maus speichert die Phase", async ({ as }) => {
  const ws = await wsId();
  const pipeline = await db().pipeline.findFirstOrThrow({ where: { workspaceId: ws, objectType: "deal" }, orderBy: { createdAt: "asc" }, include: { stages: { orderBy: { position: "asc" } } } });
  const [first, second] = pipeline.stages.filter((s) => s.kind === "OPEN");
  const deal = await db().deal.create({ data: { workspaceId: ws, pipelineId: pipeline.id, stageId: first.id, title: `Ziehen ${stamp}`, valueCents: 50000 } });

  const p = await as("admin");
  await p.goto(`${SA}/pipeline`);
  const card = p.getByRole("group", { name: `Phase ${first.name}` }).locator("div.cursor-grab", { hasText: deal.title });
  const target = p.getByRole("group", { name: `Phase ${second.name}` });
  await expect(card).toBeVisible();
  await card.scrollIntoViewIfNeeded();
  const from = (await card.boundingBox())!;
  const to = (await target.boundingBox())!;
  // wie ein Mensch: am Kartenrand (nicht auf Link/Auswahl) greifen und in Schritten ziehen
  const sx = from.x + from.width - 30, sy = from.y + from.height / 2 - 5;
  await p.mouse.move(sx, sy);
  await p.mouse.down();
  // Spalten sind gleich hoch: auf Höhe der Karte in die Nachbarspalte ziehen (bleibt im sichtbaren Bereich)
  const tx = to.x + to.width / 2, ty = sy;
  for (let i = 1; i <= 20; i++) await p.mouse.move(sx + ((tx - sx) * i) / 20, sy + ((ty - sy) * i) / 20);
  await p.mouse.up();

  await expect.poll(async () => (await db().deal.findUniqueOrThrow({ where: { id: deal.id } })).stageId, { timeout: 10_000 }).toBe(second.id);
  await p.reload();
  await expect(p.getByRole("group", { name: `Phase ${second.name}` }).getByText(deal.title)).toBeVisible();
});

for (const mode of ["dragTo", "einSprung", "amTitel"] as const) {
  // Automatische Aufnahmen und schnelle Nutzer: Ziehen in einem Satz bzw. Greifen am Titel-Link
  test(`v · Kanban: Ziehen speichert auch bei ${mode}`, async ({ as }) => {
    const ws = await wsId();
    const pipeline = await db().pipeline.findFirstOrThrow({ where: { workspaceId: ws, objectType: "deal" }, orderBy: { createdAt: "asc" }, include: { stages: { orderBy: { position: "asc" } } } });
    const [first, second] = pipeline.stages.filter((s) => s.kind === "OPEN");
    const deal = await db().deal.create({ data: { workspaceId: ws, pipelineId: pipeline.id, stageId: first.id, title: `Ziehen ${mode} ${stamp}`, valueCents: 100 } });
    const p = await as("admin");
    await p.goto(`${SA}/pipeline`);
    const card = p.getByRole("group", { name: `Phase ${first.name}` }).locator("div.cursor-grab", { hasText: deal.title });
    const target = p.getByRole("group", { name: `Phase ${second.name}` });
    await card.scrollIntoViewIfNeeded();
    const f = (await card.boundingBox())!, t = (await target.boundingBox())!;
    const ty = f.y + f.height / 2;
    // Ziel auf Höhe der Karte (die Spaltenmitte kann bei langen Spalten außerhalb des Bildschirms liegen)
    if (mode === "dragTo") await card.dragTo(target, { targetPosition: { x: t.width / 2, y: ty - t.y } });
    if (mode === "einSprung") {
      await p.mouse.move(f.x + f.width - 30, f.y + f.height / 2 - 5);
      await p.mouse.down();
      await p.mouse.move(t.x + t.width / 2, ty);
      await p.mouse.up();
    }
    if (mode === "amTitel") {
      const a = (await card.getByRole("link").boundingBox())!;
      await p.mouse.move(a.x + 5, a.y + 5);
      await p.mouse.down();
      for (let i = 1; i <= 10; i++) await p.mouse.move(a.x + 5 + ((t.x + 60 - a.x) * i) / 10, a.y + 5 + ((ty - a.y - 5) * i) / 10);
      await p.mouse.up();
      // Ziehen am Titel darf die Detailseite nicht öffnen
      await expect(p).toHaveURL(new RegExp(`${SA}/pipeline$`));
    }
    await expect.poll(async () => (await db().deal.findUniqueOrThrow({ where: { id: deal.id } })).stageId, { timeout: 10_000 }).toBe(second.id);
  });
}

test("v · Klick auf den Kartentitel öffnet weiterhin die Detailseite", async ({ as }) => {
  const ws = await wsId();
  const pipeline = await db().pipeline.findFirstOrThrow({ where: { workspaceId: ws, objectType: "deal" }, orderBy: { createdAt: "asc" }, include: { stages: { orderBy: { position: "asc" } } } });
  const deal = await db().deal.create({ data: { workspaceId: ws, pipelineId: pipeline.id, stageId: pipeline.stages[0].id, title: `Klick ${stamp}`, valueCents: 100 } });
  const p = await as("admin");
  await p.goto(`${SA}/pipeline`);
  await p.getByRole("link", { name: deal.title }).click();
  await expect(p).toHaveURL(new RegExp(`/pipeline/${deal.id}$`));
});

test("v · Einladung und KI-Anmeldung zeigen das Kundrio-Logo", async ({ page }) => {
  await page.goto("/einladung/ungueltig");
  await expect(page.getByRole("img", { name: "Kundrio" })).toBeVisible();
  await expect(page.getByRole("img", { name: /Pioneerdesk/i })).toHaveCount(0);
});
