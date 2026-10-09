import { test, expect, SA, db, wsId } from "../helpers";

// (t) Presse & Erwähnungen: Agentur-Admin und Admin (Reichweite „alle“) sehen Erwähnungen zu Firmen und Kontakten.
// Regression: ein leerer Relationsfilter ließ die Liste für Admins leer erscheinen.
const stamp = Date.now().toString(36);

test("t · Erwähnungen für Admins sichtbar", async ({ as }) => {
  const ws = await wsId();
  const company = await db().company.create({ data: { workspaceId: ws, name: `Presse-Firma ${stamp}` } });
  const contact = await db().contact.create({ data: { workspaceId: ws, email: `presse-${stamp}@kunde.example`, firstName: "Paula", lastName: `Presse-${stamp}` } });
  await db().mention.createMany({
    data: [
      { workspaceId: ws, companyId: company.id, url: `https://zeitung.example/${stamp}-firma`, title: `Firmenartikel ${stamp}`, sourceKind: "searxng", sourceHost: "zeitung.example" },
      { workspaceId: ws, contactId: contact.id, url: `https://zeitung.example/${stamp}-person`, title: `Personenartikel ${stamp}`, sourceKind: "searxng", sourceHost: "zeitung.example" },
    ],
  });

  for (const role of ["agentur-admin", "admin"] as const) {
    const p = await as(role);
    await p.goto(`${SA}/erwaehnungen?status=new`);
    await expect(p.getByText(`Firmenartikel ${stamp}`)).toBeVisible();
    await expect(p.getByText(`Personenartikel ${stamp}`)).toBeVisible();
  }
});
