import type { FullConfig } from "@playwright/test";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { AUTH_DIR, ROLE_KEYS, creds, db, storageFor } from "./helpers";

// Legt je Testbenutzer eine Sitzung direkt in der DB an (gleiches Format wie src/lib/auth.ts:
// Cookie pd_session = Token, DB speichert nur SHA-256). Grund: Das Login-Rate-Limit der App
// (20 Versuche/15 min je IP) würde 11 Rollen-Logins pro Lauf ausbremsen. Die echte Login-Seite
// wird in Suite (a) separat geprüft.
export default async function globalSetup(config: FullConfig) {
  if (!existsSync(path.join(AUTH_DIR, "credentials.json"))) throw new Error("Keine Testdaten – zuerst `npm run e2e:seed`.");
  const base = new URL(config.projects[0].use.baseURL!);
  // Rate-Limit-Zähler der lokalen Test-DB leeren (sonst blockieren wiederholte Login-Tests);
  // im alten Build (In-Memory-Limit) hilft nur ein Neustart der App.
  await db().$executeRawUnsafe('DELETE FROM "RateLimitBucket"').catch(() => {});
  const c = creds();
  for (const role of ROLE_KEYS) {
    const user = await db().user.findUniqueOrThrow({ where: { email: c.users[role].email } });
    const token = randomBytes(32).toString("base64url");
    const expires = new Date(Date.now() + 6 * 3600e3);
    await db().session.create({ data: { tokenHash: createHash("sha256").update(token).digest("hex"), userId: user.id, expiresAt: expires } });
    writeFileSync(
      storageFor(role),
      JSON.stringify({
        cookies: [{ name: "pd_session", value: token, domain: base.hostname, path: "/", expires: Math.floor(expires.getTime() / 1000), httpOnly: true, secure: base.protocol === "https:", sameSite: "Lax" }],
        origins: [],
      }),
    );
  }
  await db().$disconnect();
}
