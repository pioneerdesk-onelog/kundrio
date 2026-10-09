import "server-only";
import { registerApprovalKind } from "../approvals";
import { sendDocument } from "./send";

// Belegversand per E-Mail ist Außenwirkung: ohne Freigaberecht bzw. bei Vier-Augen über den Freigabe-Eingang.
registerApprovalKind("document.send", "Beleg per E-Mail senden", async (p, ctx) => {
  const r = await sendDocument(
    ctx.workspaceId,
    String(p.invoiceId),
    ctx.decidedBy,
    { to: typeof p.to === "string" ? p.to : undefined, subject: typeof p.subject === "string" ? p.subject : undefined, body: typeof p.body === "string" ? p.body : undefined },
    { withAcceptLink: p.withAcceptLink !== false },
  );
  return { emailId: r.emailId, delivery: r.delivery };
});
