import "server-only";
import { registerApprovalKind } from "../approvals";
import { sendDunning } from "./service";

// Mahnungen sind Außenwirkung: der Mahnlauf stellt nur Anfragen, ein Mensch gibt jede Mahnung frei.
registerApprovalKind("dunning.send", "Mahnung senden", async (p, ctx) => {
  const str = (v: unknown) => (typeof v === "string" ? v : undefined);
  const r = await sendDunning(ctx.workspaceId, String(p.invoiceId), Number(p.level), ctx.decidedBy, { to: str(p.to), subject: str(p.subject), body: str(p.body) });
  return { skipped: r.skipped, emailId: r.emailId };
});
