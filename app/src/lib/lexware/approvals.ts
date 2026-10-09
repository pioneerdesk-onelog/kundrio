import "server-only";
import { registerApprovalKind } from "../approvals";
import { pushInvoice } from "./sync";

// Übertragung an die Buchhaltung ist Außenwirkung: aus Prozessen/MCP nur über den Freigabe-Eingang.
registerApprovalKind("lexware.push_invoice", "Beleg an Lexware übertragen", async (p, ctx) => {
  const r = await pushInvoice(ctx.workspaceId, String(p.invoiceId), ctx.decidedBy, { finalize: p.finalize === true });
  return { lexwareId: r.id, link: r.link };
});
