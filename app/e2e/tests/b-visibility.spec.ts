import { test, expect, expectAllowed, expectDenied, ROLE_KEYS, SA, AREAS, meetsNeed, hasSpecial, beleg, type RoleKey } from "../helpers";

// (b) Sichtbarkeits-Matrix je Rolle – abgeleitet aus derselben Quelle wie die App
// (src/lib/permissions/areas.ts + Rollenvorlagen), damit Test und Navigation nie auseinanderlaufen.
for (const role of ROLE_KEYS) {
  test(`b · Seiten-Matrix: ${role}`, async ({ as }) => {
    const p = await as(role);
    await expectAllowed(p, SA); // Dashboard für alle Mitglieder
    for (const [area, need] of AREAS) {
      const url = `${SA}/${area}`;
      if (meetsNeed(role, need)) await expectAllowed(p, url);
      else await expectDenied(p, url);
    }
    beleg(`${role}: ${AREAS.length} Bereiche gegen areas.ts + Rollenvorlage geprüft`);
  });
}

const AGENCY_ONLY = ["/benutzer", "/kosten"];
for (const role of ["agentur-admin", "agentur-mitarbeiter", "admin", "vertrieb-a"] as RoleKey[]) {
  test(`b · Agentur-Seiten: ${role}`, async ({ as }) => {
    const p = await as(role);
    for (const url of AGENCY_ONLY) {
      if (role === "agentur-admin") await expectAllowed(p, url);
      else await expectDenied(p, url);
    }
  });
}

test("b · Reichweite: Vertrieb A sieht eigene + Team + unzugewiesene, nicht Vertrieb C", async ({ as }) => {
  const p = await as("vertrieb-a");
  await p.goto(`${SA}/kontakte`);
  const body = p.locator("main");
  await expect(body).toContainText("Brenner"); // eigen
  await expect(body).toContainText("Huber"); // Teamkollege B
  await expect(body).toContainText("Kraus"); // unzugewiesen
  await expect(body).not.toContainText("Seidl"); // Vertrieb C (anderes Team)
  await expect(body).not.toContainText("Lindner"); // Vertrieb C
  beleg("vertrieb-a: Brenner/Huber/Kraus sichtbar, Seidl/Lindner nicht");
});

test("b · Reichweite: Vertrieb C sieht nur Nord + unzugewiesene", async ({ as }) => {
  const p = await as("vertrieb-c");
  await p.goto(`${SA}/kontakte`);
  const body = p.locator("main");
  await expect(body).toContainText("Seidl");
  await expect(body).toContainText("Lindner");
  await expect(body).not.toContainText("Brenner");
  await expect(body).not.toContainText("Huber");
});

test("b · Vertrieb kann fremden Kontakt nicht per Direktlink öffnen", async ({ as }) => {
  const { db } = await import("../helpers");
  const seidl = await db().contact.findFirstOrThrow({ where: { email: { startsWith: "m.seidl@" } } });
  const p = await as("vertrieb-a");
  await expectDenied(p, `${SA}/kontakte/${seidl.id}`);
});

for (const role of ROLE_KEYS) {
  test(`b · Export nur mit Recht: ${role}`, async ({ as }) => {
    const p = await as(role);
    const res = await p.request.get(`${SA}/kontakte/export`);
    if (hasSpecial(role, "export")) {
      expect(res.status()).toBe(200);
      expect(res.headers()["content-type"]).toContain("text/csv");
    } else {
      expect([302, 303, 307, 403, 404]).toContain(res.status());
    }
  });
}

test("b · Nur-lesen sieht keine Schaltflächen zum Anlegen/Löschen", async ({ as }) => {
  const p = await as("nurlesen");
  await p.goto(`${SA}/kontakte`);
  await expect(p.getByRole("button", { name: "Anlegen" })).toHaveCount(0);
  await expect(p.getByRole("button", { name: "Löschen" })).toHaveCount(0);
});
