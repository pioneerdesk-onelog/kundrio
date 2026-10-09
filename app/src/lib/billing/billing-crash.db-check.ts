// DB-Prüfung Abrechnungslauf bei Absturz (kein vitest – braucht eine Datenbank):
//   npx tsx --conditions=react-server --env-file=.env src/lib/billing/billing-crash.db-check.ts
// Robustheitstest 2026-10-07 (LR-4): Worker während billing.run hart beendet (kill -9) → die gerade erzeugte
// Abo-Rechnung blieb Entwurf, ohne Versand und OHNE Aufgabe; der Neustart überspringt die Periode (idempotent)
// → Rechnung still verloren. Erwartung: Jede erzeugte Rechnung hat ab dem Commit eine offene Aufgabe.
// Ablauf deterministisch: Kindprozess ruft runBilling auf; die Tabelle AppSetting ist gesperrt, sodass er direkt
// nach dem Commit der Rechnung (getAutoSend) wartet; dann SIGKILL. Danach Prüfung und Aufräumen (Cascade).
// Hinweis: sperrt AppSetting für wenige Sekunden – nicht gegen eine stark genutzte Datenbank laufen lassen.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { PrismaClient } from "@prisma/client";

const CHILD = process.argv[2] === "--child";

async function child(workspaceId: string) {
  const { runBilling } = await import("./service");
  await runBilling(workspaceId);
}

async function main() {
  const db = new PrismaClient();
  const { createMandate, createSubscription, setAutoSend } = await import("./service");
  const agency = (await db.agency.findFirst()) ?? (await db.agency.create({ data: { name: "db-check" } }));
  const ws = await db.workspace.create({
    data: { agencyId: agency.id, slug: `dbcheck-billcrash-${Date.now()}`, name: "db-check Abrechnung", mailFromEmail: "info@dbcheck.example", creditorId: "DE98ZZZ09999999999", iban: "DE02120300000000202051", legalName: "db-check GmbH" },
  });
  const locker = new PrismaClient();
  try {
    const contact = await db.contact.create({ data: { workspaceId: ws.id, email: "kunde@dbcheck.example", firstName: "Test", lastName: "Kunde" } });
    const m = await createMandate(ws.id, { contactId: contact.id, accountHolder: "Test Kunde", iban: "DE02120300000000202051", scheme: "CORE", signedAt: new Date(Date.now() - 60 * 864e5) }, "user:db-check");
    const sub = await createSubscription(ws.id, { contactId: contact.id, items: [{ title: "Wartung", qty: 1, unitCents: 4900, vatRate: 19, unit: "MON" }], interval: "monthly", startDate: new Date(Date.now() - 5 * 864e5), minTermMonths: 0, noticePeriodDays: 30, paymentMethod: "sepa", mandateId: m.id, consumer: false }, "user:db-check");
    await setAutoSend(sub.id, true, "user:db-check");

    // AppSetting sperren → Kindprozess hält direkt nach dem Rechnungs-Commit an (getAutoSend)
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    let locked!: () => void;
    const isLocked = new Promise<void>((r) => (locked = r));
    const lockTx = locker.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe(`LOCK TABLE "AppSetting" IN ACCESS EXCLUSIVE MODE`);
        locked();
        await held;
      },
      { timeout: 60_000 },
    );
    await isLocked;
    const proc = spawn(process.execPath, [...process.execArgv, __filename, "--child", ws.id], { stdio: "inherit", env: process.env });
    const start = Date.now();
    let invoices = 0;
    while (Date.now() - start < 30_000 && (invoices = await db.invoice.count({ where: { workspaceId: ws.id } })) === 0) await new Promise((r) => setTimeout(r, 50));
    await new Promise((r) => setTimeout(r, 300)); // Kind steht jetzt in getAutoSend
    proc.kill("SIGKILL");
    await new Promise((r) => proc.once("exit", r));
    release();
    await lockTx;
    assert.equal(invoices, 1, "Kindprozess hat die Rechnung erzeugt");

    const inv = await db.invoice.findFirstOrThrow({ where: { workspaceId: ws.id } });
    const tasks = await db.task.count({ where: { workspaceId: ws.id, contactId: contact.id, doneAt: null } });
    const mails = await db.emailMessage.count({ where: { workspaceId: ws.id } });
    console.log(`Nach Absturz: Rechnung ${inv.status}, Mails ${mails}, offene Aufgaben ${tasks}`);
    assert.ok(inv.status === "SENT" || tasks >= 1, "Rechnung weder versendet noch als Aufgabe sichtbar → nach Absturz verloren");
    console.log("✅ Abo-Rechnung bleibt nach Absturz sichtbar (offene Aufgabe)");
  } finally {
    await db.workspace.delete({ where: { id: ws.id } }).catch(() => {});
    await db.$disconnect();
    await locker.$disconnect();
  }
}

(CHILD ? child(process.argv[3]) : main())
  .catch((e) => {
    console.error("❌", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  });
