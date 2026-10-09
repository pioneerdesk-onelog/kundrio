// Nur Demo-Instanz: Gastkonto aus DEMO_GUEST ("guest:guest@demo.kundrio.de") mit DEMO_GUEST_PASSWORD anlegen.
// Agentur-Admin (nicht Inhaber), damit Gäste alles sehen; Sperren/Passwortwechsel blockiert src/lib/demo.ts.
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/lib/password";
import { demoGuest } from "../src/lib/demo";

const db = new PrismaClient();

async function main() {
  const g = demoGuest();
  const password = process.env.DEMO_GUEST_PASSWORD;
  if (!g || !password) throw new Error("DEMO_GUEST und DEMO_GUEST_PASSWORD setzen (nur in der Demo-Instanz).");
  const data = { name: "Gast (Demo)", agencyRole: "admin", isAgencyAdmin: true, active: true, passwordHash: await hashPassword(password) };
  await db.user.upsert({ where: { email: g.email }, update: data, create: { email: g.email, ...data } });
  console.log(`Demo-Gastkonto „${g.alias}“ bereit.`);
}

main().catch((e) => { console.error(e.message); process.exitCode = 1; }).finally(() => db.$disconnect());
