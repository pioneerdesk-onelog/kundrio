import "server-only";
import { db } from "../db";
import { registerApprovalKind } from "../approvals";
import { sendMail } from "../mail";
import { eraseContact } from "../privacy/erase";
import { enrollObject, setProcessStatus } from "../process/api";

// Ausführer für Freigaben, die über den Admin-MCP beantragt werden.
// "process.publish" registriert die Prozess-Engine selbst.

registerApprovalKind("mail.send", "E-Mail an Kontakt", async (p, ctx) => {
  const contact = await db.contact.findFirst({ where: { id: String(p.contactId), workspaceId: ctx.workspaceId } });
  if (!contact?.email) throw new Error("Kontakt oder E-Mail-Adresse existiert nicht mehr.");
  const messageId = await sendMail({
    workspaceId: ctx.workspaceId,
    to: contact.email,
    subject: String(p.subject),
    text: String(p.body),
    contactId: contact.id,
    kind: "one_to_one",
  });
  return { messageId };
});

registerApprovalKind("contact.delete", "Kontakt löschen", async (p, ctx) => {
  const r = await eraseContact(ctx.workspaceId, String(p.contactId), ctx.decidedBy);
  if (r.mode === "not_found") throw new Error("Kontakt existiert nicht mehr.");
  return { mode: r.mode, counts: r.counts, manualReview: r.manualReview.length };
});

registerApprovalKind("process.enroll", "In Prozess einschreiben", async (p, ctx) => {
  const r = await enrollObject(ctx.workspaceId, String(p.processId), String(p.objectId), { actor: ctx.decidedBy });
  return { runId: r.runId };
});

registerApprovalKind("process.status", "Prozess aktivieren", async (p, ctx) => {
  const status = String(p.status) as "ACTIVE" | "PAUSED" | "ARCHIVED";
  await setProcessStatus(ctx.workspaceId, String(p.processId), status, ctx.decidedBy);
  return { status };
});
