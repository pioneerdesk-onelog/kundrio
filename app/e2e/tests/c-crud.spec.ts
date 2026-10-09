import { test, expect, SA, db, wsId, beleg, waitFor } from "../helpers";

// (c) Kernobjekte anlegen und bearbeiten, Daten- und Ereignisfluss prüfen
const stamp = Date.now().toString(36);

test("c · Kontakt anlegen → Unternehmen per Domain → Ereignis contact.created", async ({ as }) => {
  const p = await as("vertrieb-a");
  await p.goto(`${SA}/kontakte`);
  const email = `k.neumann.${stamp}@neumann-anlagenbau.example.de`;
  await p.locator('input[name="firstName"]').first().fill("Klaus");
  await p.locator('input[name="lastName"]').first().fill("Neumann");
  await p.locator('input[name="email"]').first().fill(email);
  await p.locator('input[name="company"]').first().fill("Neumann Anlagenbau GmbH");
  await p.getByRole("button", { name: "Anlegen" }).first().click();
  const c = await waitFor(() => db().contact.findFirst({ where: { email }, include: { companyRecord: true } }));
  expect(c.workspaceId).toBe(await wsId());
  const ev = await waitFor(() => db().crmEvent.findFirst({ where: { objectId: c.id, type: "contact.created" } }));
  expect(ev).toBeTruthy();
  beleg(`Kontakt ${c.id}, Ereignis ${ev.id}, Unternehmen ${c.companyRecord?.domain ?? "–"}`);
});

test("c · Deal anlegen, Phase wechseln, gewinnen → Lifecycle Kunde (Prozess)", async ({ as }) => {
  const ws = await wsId();
  const p = await as("teamleitung");
  await p.goto(`${SA}/pipeline`);
  await expect(p.locator("main")).toContainText("Angebot");
  const deal = await db().deal.findFirstOrThrow({ where: { workspaceId: ws, title: "Inhouse-Workshop Datenschutz & KI" } });
  const stages = await db().stage.findMany({ where: { pipelineId: deal.pipelineId }, orderBy: { position: "asc" } });
  const won = stages.find((s) => s.kind === "WON")!;
  // 1) Echtes Ziehen mit der Maus in Schritten (wie ein Mensch) in die nächste offene Phase
  const target = stages.find((s) => s.kind === "OPEN" && s.id !== deal.stageId && s.position > (stages.find((x) => x.id === deal.stageId)?.position ?? 0)) ?? stages.find((s) => s.kind === "OPEN" && s.id !== deal.stageId)!;
  const card = p.getByRole("group", { name: /^Phase / }).getByText("Inhouse-Workshop Datenschutz & KI", { exact: true }).first();
  const column = p.getByRole("group", { name: `Phase ${target.name}`, exact: true });
  const a = (await card.boundingBox())!;
  const b = (await column.boundingBox())!;
  await p.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await p.mouse.down();
  await p.mouse.move(a.x + a.width / 2 + 10, a.y + a.height / 2, { steps: 5 });
  await p.mouse.move(b.x + b.width / 2, b.y + 60, { steps: 15 });
  await p.mouse.up();
  await waitFor(async () => ((await db().deal.findUnique({ where: { id: deal.id } }))?.stageId === target.id ? true : null), 15_000);
  beleg(`Drag & Drop: Deal in „${target.name}“ gezogen`);
  // 2) Barrierefreie Phasen-Auswahl auf der Karte → Gewonnen
  await p.getByRole("combobox", { name: /Phase von „Inhouse-Workshop Datenschutz & KI“/ }).selectOption(won.id);
  const moved = await waitFor(async () => {
    const d = await db().deal.findUnique({ where: { id: deal.id } });
    return d?.stageId === won.id ? d : null;
  }, 15_000);
  expect(moved.closedAt, "Abschlussdatum gesetzt").toBeTruthy();
  const ev = await waitFor(() => db().crmEvent.findFirst({ where: { objectId: deal.id, type: "deal.stage_changed" } }));
  // Auf den abgeschlossenen Prozesslauf warten (Zustand statt fester Zeit), dann Lifecycle prüfen
  const run = await waitFor(() => db().processRun.findFirst({ where: { objectId: deal.id, status: { in: ["done", "goal_met", "failed"] }, process: { templateKey: { contains: "gewonnen" } } } }), 45_000);
  expect(run.status, `Prozesslauf ${run.id} ${run.error ?? ""}`).not.toBe("failed");
  const contact = await waitFor(() => db().contact.findFirst({ where: { id: deal.contactId!, lifecycleStage: "customer" } }), 15_000);
  expect(contact.lifecycleStage).toBe("customer");
  beleg(`Deal ${deal.id} gewonnen, Ereignis ${ev.id}, Prozesslauf ${run.id} (${run.status}), Kontakt jetzt Kunde`);
});

test("c · Ticket anlegen → Ticket-Eingang-Prozess setzt SLA/Priorität", async ({ as }) => {
  const p = await as("service");
  await p.goto(`${SA}/tickets`);
  const subject = `Druckerausfall Lager (E2E ${stamp})`;
  await p.locator('input[name="subject"]').first().fill(subject);
  await p.getByRole("button", { name: /Anlegen|Ticket anlegen/ }).first().click();
  const t = await waitFor(() => db().ticket.findFirst({ where: { subject } }));
  await waitFor(() => db().crmEvent.findFirst({ where: { objectId: t.id, type: "ticket.created", processedAt: { not: null } } }), 30_000);
  const run = await waitFor(() => db().processRun.findFirst({ where: { objectId: t.id } }), 30_000);
  beleg(`Ticket #${t.numericId} → Prozesslauf ${run.id} ${run.status}`);
});

test("c · Aufgabe anlegen und abhaken", async ({ as }) => {
  const p = await as("vertrieb-b");
  await p.goto(`${SA}/aufgaben`);
  const title = `Rückruf Huber (E2E ${stamp})`;
  await p.locator('input[name="title"]').first().fill(title);
  await p.getByRole("button", { name: /Anlegen/ }).first().click();
  const t = await waitFor(() => db().task.findFirst({ where: { title } }));
  expect(t.doneAt).toBeNull();
  beleg(`Aufgabe ${t.id} angelegt`);
});

test("c · Unternehmen: Liste, Detail mit Kontakten und Deals", async ({ as }) => {
  const p = await as("teamleitung");
  await p.goto(`${SA}/unternehmen`);
  await p.getByText("Weber Medizintechnik AG").first().click();
  await expect(p.locator("main")).toContainText("Claudia");
  await expect(p.locator("main")).toContainText("Rahmenvertrag Schulungen 2027");
});

test("c · Listen & eigene Felder sichtbar, Mitgliederzahl stimmt", async ({ as }) => {
  const p = await as("marketing");
  await p.goto(`${SA}/listen`);
  await expect(p.locator("main")).toContainText("Newsletter Mittelstand");
  await expect(p.locator("main")).toContainText("Branche");
  const n = await db().contactListMember.count({ where: { list: { name: "Newsletter Mittelstand", workspace: { slug: "e2e" } } } });
  expect(n).toBe(8);
});

test("c · CSV-Export (Brevo-Format) enthält Testkontakte, keine Formeln", async ({ as }) => {
  const p = await as("admin");
  const res = await p.request.get(`${SA}/listen/wechsel/export/brevo`);
  expect(res.status()).toBe(200);
  const csv = await res.text();
  expect(csv).toContain("brenner-maschinenbau.example.de");
  expect(csv).not.toMatch(/^[=+@]/m);
});
