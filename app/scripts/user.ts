// Benutzer anlegen (es gibt bewusst keine Selbstregistrierung).
//   npm run user:create -- <email> "<Name>" [--agency] [--workspace slug:ADMIN|MEMBER ...]
// Das Passwort wird zufällig erzeugt und EINMAL angezeigt; danach unter /konto ändern.
import { PrismaClient } from "@prisma/client";
import { randomBytes } from "node:crypto";
import { hashPassword } from "../src/lib/password";
import { agencyFieldsForCli } from "../src/lib/user-setup";

const db = new PrismaClient();

async function main() {
  const [email, name, ...rest] = process.argv.slice(2);
  if (!email || !name) throw new Error('Aufruf: npm run user:create -- mail@domain.de "Vorname Nachname" [--agency] [--workspace onelog:ADMIN]');
  const isAgencyAdmin = rest.includes("--agency");
  const grants: { slug: string; role: "ADMIN" | "MEMBER" }[] = [];
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === "--workspace" && rest[i + 1]) {
      const [slug, role = "MEMBER"] = rest[++i].split(":");
      grants.push({ slug, role: role.toUpperCase() === "ADMIN" ? "ADMIN" : "MEMBER" });
    }
  }
  const password = randomBytes(15).toString("base64url");
  // Erster Agentur-Benutzer wird Inhaber, weitere Admin (isAgencyAdmin + agencyRole gemeinsam, LR-9)
  const activeOwners = await db.user.count({ where: { agencyRole: "owner", active: true, email: { not: email.toLowerCase() } } });
  const agencyFields = agencyFieldsForCli({ agency: isAgencyAdmin, activeOwners });
  const user = await db.user.upsert({
    where: { email: email.toLowerCase() },
    update: { name, ...agencyFields, passwordHash: await hashPassword(password) },
    create: { email: email.toLowerCase(), name, ...agencyFields, passwordHash: await hashPassword(password) },
  });
  await db.session.deleteMany({ where: { userId: user.id } });
  for (const g of grants) {
    const ws = await db.workspace.findUniqueOrThrow({ where: { slug: g.slug } });
    await db.membership.upsert({
      where: { userId_workspaceId: { userId: user.id, workspaceId: ws.id } },
      update: { role: g.role },
      create: { userId: user.id, workspaceId: ws.id, role: g.role },
    });
  }
  console.log(`Benutzer ${user.email} ${isAgencyAdmin ? `(Agentur, Rolle ${agencyFields.agencyRole === "owner" ? "Inhaber" : "Admin"})` : ""} bereit.`);
  console.log(`Einmal-Passwort: ${password}`);
  console.log("Bitte nach der ersten Anmeldung unter /konto ändern.");
}

main().catch((e) => { console.error(e.message); process.exitCode = 1; }).finally(() => db.$disconnect());
