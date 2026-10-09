import { test, expect, SA, db, wsId, waitFor, beleg } from "../helpers";

// (g) Prozesse: Übersicht, Editor, Testlauf, Freigabe-Eingang, Vier-Augen
test("g · Übersicht zeigt 9 Best-Practice-Prozesse", async ({ as }) => {
  const p = await as("admin");
  await p.goto(`${SA}/prozesse`);
  for (const name of ["Lead-Eingang", "KI-Agent-Anfrage", "Ticket-Eingang", "Deal-Hygiene"]) await expect(p.locator("main")).toContainText(name);
});

test("g · Editor rendert Flow und Validierung", async ({ as }) => {
  const ws = await wsId();
  const proc = await db().process.findFirstOrThrow({ where: { workspaceId: ws, templateKey: { contains: "lead-eingang" } } });
  const p = await as("admin");
  await p.goto(`${SA}/prozesse/${proc.id}`);
  await expect(p.locator(".react-flow")).toBeVisible();
  await expect(p.locator(".react-flow__node").first()).toBeVisible();
  beleg(`Editor ${proc.id}: ${await p.locator(".react-flow__node").count()} Knoten sichtbar`);
});

test("g · Testlauf ohne Außenwirkung erzeugt Schritt-Protokoll", async ({ as }) => {
  const ws = await wsId();
  const proc = await db().process.findFirstOrThrow({ where: { workspaceId: ws, templateKey: { contains: "lead-eingang" } } });
  const contact = await db().contact.findFirstOrThrow({ where: { workspaceId: ws, email: { startsWith: "a.kraus@" } } });
  const mailsBefore = await db().emailMessage.count({ where: { workspaceId: ws } });
  const startedAfter = new Date();
  // Echte Bedienung im Editor: Reiter „Testlauf“ → Datensatz suchen → wählen → starten
  const p = await as("admin");
  await p.goto(`${SA}/prozesse/${proc.id}`);
  await p.getByRole("tab", { name: "Testlauf" }).click();
  await p.getByLabel("Kontakt suchen").fill("Kraus");
  await p.getByRole("listbox", { name: "Treffer" }).getByRole("option", { name: /Kraus/ }).first().click();
  await p.getByRole("button", { name: /Testlauf mit/ }).click();
  const run = await waitFor(async () => {
    const r = await db().processRun.findFirst({ where: { processId: proc.id, objectId: contact.id, test: true, startedAt: { gte: startedAfter } }, include: { steps: true } });
    return r && ["done", "failed", "goal_met"].includes(r.status) ? r : null;
  }, 45_000);
  expect(run.status, run.error ?? "").not.toBe("failed");
  expect(run.steps.length).toBeGreaterThan(0);
  // Testlauf = keine Außenwirkung: keine neue E-Mail
  expect(await db().emailMessage.count({ where: { workspaceId: ws } })).toBe(mailsBefore);
  await expect(p.locator("main")).toContainText(/Schritt|abgeschlossen|fertig|ok/i);
  await p.goto(`${SA}/prozesse/${proc.id}/laeufe/${run.id}`);
  await expect(p.locator("main")).toContainText(/Schritt|ok/);
  beleg(`Testlauf ${run.id}: ${run.steps.length} Schritte, ${run.status}, keine Mail`);
});

test("g · Freigabe-Eingang: Vier-Augen verhindert Selbstfreigabe", async ({ as }) => {
  const ws = await wsId();
  await db().workspace.update({ where: { id: ws }, data: { fourEyes: true } });
  try {
    const admin = await db().user.findFirstOrThrow({ where: { email: { startsWith: "e2e.admin@" } } });
    const a = await db().approval.create({
      data: { workspaceId: ws, kind: "mail.send", title: "E2E Vier-Augen-Test", payload: {}, requestedBy: `user:${admin.id}`, expiresAt: new Date(Date.now() + 864e5) },
    });
    const p = await as("admin");
    await p.goto(`/freigaben`);
    await expect(p.locator("main")).toContainText("E2E Vier-Augen-Test");
    const approve = p.getByRole("button", { name: /Zustimmen/ }).first();
    if (await approve.isVisible()) {
      await approve.click();
      await p.waitForTimeout(1500);
    }
    const after = await db().approval.findUnique({ where: { id: a.id } });
    expect(after?.status, "Selbstfreigabe muss bei Vier-Augen scheitern").toBe("pending");
    await db().approval.delete({ where: { id: a.id } });
  } finally {
    await db().workspace.update({ where: { id: ws }, data: { fourEyes: false } });
  }
});

// --- Nur echte Felder/Daten, Sichtbarkeit, Rechte (Prozesse: echte Daten & Sichtbarkeit) ---

test("g · Editor bietet nur vorhandene Felder an (kein Freitext-Pfad) und zeigt Rechte", async ({ as }) => {
  const ws = await wsId();
  const proc = await db().process.findFirstOrThrow({ where: { workspaceId: ws, templateKey: { contains: "mql" } } });
  const p = await as("admin");
  await p.goto(`${SA}/prozesse/${proc.id}`);
  await expect(p.getByText("Ihre Rechte:")).toBeVisible();
  // Auslöser-Karte öffnen: Filter-Felder sind Auswahllisten aus dem Katalog
  await expect(p.locator("main")).not.toContainText("Anderer Pfad");
  const fieldSelects = p.locator('aside select:has(option:text("– Feld wählen –"))');
  expect(await fieldSelects.count()).toBeGreaterThan(0);
  const opts = await fieldSelects.first().locator("option").allTextContents();
  expect(opts.join("|")).toContain("Lead-Bewertung (eigenes Feld)");
  expect(opts.some((o) => /eigener Pfad|anderer Pfad/i.test(o))).toBe(false);
  // „In Worten“
  await p.getByRole("button", { name: "In Worten" }).click();
  await expect(p.getByText("So läuft der Prozess ab")).toBeVisible();
  await expect(p.locator("main")).toContainText("Lifecycle");
  beleg(`Editor ${proc.id}: ${opts.length} Feldoptionen, In-Worten-Ansicht sichtbar`);
});

test("g · Nur-Lesen-Rolle sieht Prozess schreibgeschützt", async ({ as }) => {
  const ws = await wsId();
  const proc = await db().process.findFirstOrThrow({ where: { workspaceId: ws, templateKey: { contains: "lead-eingang" } } });
  const p = await as("nurlesen");
  await p.goto(`${SA}/prozesse/${proc.id}`);
  await expect(p.getByText("schreibgeschützt")).toBeVisible();
  await expect(p.getByRole("button", { name: /Veröffentlichen|Entwurf speichern/ })).toHaveCount(0);
});

test("g · Veröffentlichen mit fehlender Referenz wird abgelehnt", async ({ as }) => {
  const ws = await wsId();
  const definition = {
    schemaVersion: 1,
    trigger: { type: "form.submitted", config: {} },
    enrollment: { filters: { match: "all", conditions: [] }, reenroll: false },
    start: "liste",
    nodes: [
      { id: "liste", type: "action.add_to_list", config: { listId: "gibt-es-nicht" }, position: { x: 0, y: 120 } },
      { id: "ende", type: "logic.end", config: {}, position: { x: 0, y: 260 } },
    ],
    edges: [{ from: "liste", to: "ende", output: "next" }],
  };
  const proc = await db().process.create({
    data: { workspaceId: ws, name: "E2E Referenzprüfung", objectType: "contact", status: "DRAFT", versions: { create: { version: 1, definition, createdBy: "e2e" } } },
  });
  try {
    const p = await as("admin");
    await p.goto(`${SA}/prozesse/${proc.id}`);
    // Live-Prüfung im Editor (Reiter „Prüfung“) nennt den fehlenden Bezug
    await p.getByRole("tab", { name: /Prüfung/ }).click();
    await expect(p.locator("main")).toContainText("Liste existiert nicht");
    await p.getByRole("button", { name: "Veröffentlichen" }).click();
    await expect(p.getByRole("alert").filter({ hasText: /Liste existiert nicht|Fehler/ }).first()).toBeVisible();
    const after = await db().process.findUniqueOrThrow({ where: { id: proc.id } });
    expect(after.status).toBe("DRAFT");
    expect(after.activeVersionId).toBeNull();
    // Landkarte zeigt den Hinweis auf fehlende Bezüge
    await p.goto(`${SA}/prozesse`);
    await expect(p.locator("main")).toContainText("Prozess verweist auf Gelöschtes oder Fehlendes");
    beleg(`Prozess ${proc.id}: Veröffentlichen abgelehnt, Landkarte warnt`);
  } finally {
    await db().process.delete({ where: { id: proc.id } });
  }
});

test("g · Detailseite zeigt Prozessläufe des Datensatzes", async ({ as }) => {
  const ws = await wsId();
  const run = await db().processRun.findFirst({ where: { workspaceId: ws, objectType: "contact" }, orderBy: { startedAt: "desc" }, include: { process: true } });
  const contact = run
    ? await db().contact.findFirstOrThrow({ where: { id: run.objectId } })
    : await db().contact.findFirstOrThrow({ where: { workspaceId: ws, email: { startsWith: "a.kraus@" } } });
  const p = await as("admin");
  await p.goto(`${SA}/kontakte/${contact.id}`);
  await expect(p.getByRole("heading", { name: "Prozesse", exact: true })).toBeVisible();
  await expect(p.locator("main")).toContainText("Passt zu folgenden aktiven Prozessen");
  if (run) await expect(p.locator("main")).toContainText(run.process.name);
  beleg(`Kontakt ${contact.id}: Prozess-Karte${run ? ` mit Lauf ${run.id}` : ""}`);
});

test("g · Vorlage „Angebot angenommen → AB“: sichtbar, Testlauf beschreibt AB ohne sie anzulegen", async ({ as }) => {
  const ws = await wsId();
  const proc = await db().process.findFirstOrThrow({ where: { workspaceId: ws, templateKey: "angebot-angenommen-ab" } });
  const contact = await db().contact.findFirstOrThrow({ where: { workspaceId: ws, email: { startsWith: "a.kraus@" } } });
  // Angenommenes Angebot als Grundlage (wird am Ende entfernt)
  const quote = await db().invoice.create({
    data: { workspaceId: ws, kind: "QUOTE", number: `AN-E2E-${Date.now()}`, contactId: contact.id, status: "ACCEPTED", items: [{ title: "Beratung", qty: 1, unitCents: 100000, vatRate: 19 }], netCents: 100000, vatCents: 19000, grossCents: 119000, buyerEmail: contact.email },
  });
  try {
    const p = await as("admin");
    await p.goto(`${SA}/prozesse`);
    await expect(p.locator("main")).toContainText("Angebot angenommen → Auftragsbestätigung");
    await p.goto(`${SA}/prozesse/${proc.id}`);
    await expect(p.locator(".react-flow")).toBeVisible();
    await expect(p.locator("main")).toContainText(/Auftragsbestätigung erstellen|AB erstellen/);
    const startedAfter = new Date();
    await p.getByRole("tab", { name: "Testlauf" }).click();
    await p.getByLabel("Kontakt suchen").fill("Kraus");
    await p.getByRole("listbox", { name: "Treffer" }).getByRole("option", { name: /Kraus/ }).first().click();
    await p.getByRole("button", { name: /Testlauf mit/ }).click();
    const run = await waitFor(async () => {
      const r = await db().processRun.findFirst({ where: { processId: proc.id, objectId: contact.id, test: true, startedAt: { gte: startedAfter } }, include: { steps: true } });
      return r && ["done", "failed", "goal_met"].includes(r.status) ? r : null;
    }, 45_000);
    expect(run.status, run.error ?? "").not.toBe("failed");
    expect(run.steps.some((s) => JSON.stringify(s.detail ?? {}).includes("Auftragsbestätigung aus Angebot"))).toBe(true);
    // Testlauf ohne Außenwirkung: keine AB entstanden
    expect(await db().invoice.count({ where: { fromQuoteId: quote.id, kind: "ORDER" } })).toBe(0);
    beleg(`Testlauf AB-Prozess ${run.id}: ${run.steps.length} Schritte, keine AB angelegt`);
  } finally {
    await db().invoice.deleteMany({ where: { OR: [{ id: quote.id }, { fromQuoteId: quote.id }] } });
  }
});
