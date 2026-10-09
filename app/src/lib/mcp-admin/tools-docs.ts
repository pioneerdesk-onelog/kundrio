import "server-only";
import { z } from "zod";
import { db } from "../db";
import { requestApproval } from "../approvals";
import { createOrderFromQuote, DocumentFlowError } from "../documents/flow";
import { DATA_NOTE, McpToolError, approvalLink, idArg, need, tool } from "./context";

// Admin-MCP: Belege (Angebot → Auftragsbestätigung → Rechnung). Versand an Kunden nur über Freigabe.

const KIND_DE: Record<string, string> = { QUOTE: "Angebot", ORDER: "Auftragsbestätigung", INVOICE: "Rechnung" };

async function findDocument(workspaceId: string, ref: string) {
  const doc = await db.invoice.findFirst({
    where: { workspaceId, OR: [{ id: ref }, { number: ref }] },
    select: { id: true, kind: true, number: true, status: true, contactId: true, buyerEmail: true, grossCents: true, contact: { select: { email: true, ownerId: true } } },
  });
  if (!doc) throw new McpToolError(`Beleg „${ref}“ nicht gefunden.`);
  return doc;
}

export const docTools = [
  tool({
    name: "create_order_confirmation",
    title: "Auftragsbestätigung aus Angebot erstellen",
    description:
      "Erstellt aus einem Angebot (ID oder Nummer, z. B. AN-2026-0001) eine Auftragsbestätigung als Entwurf und markiert das Angebot als angenommen. Es wird nichts an den Kunden gesendet." + DATA_NOTE,
    access: "write",
    perm: { object: "invoices", action: "edit" },
    input: z.object({ quote: z.string().trim().min(1).max(60).describe("Angebots-ID oder -Nummer"), customerOrderRef: z.string().trim().max(100).optional().describe("Bestellnummer des Kunden") }),
    run: async (a, ctx) => {
      const q = await findDocument(ctx.workspaceId, a.quote);
      if (q.kind !== "QUOTE") throw new McpToolError(`${q.number} ist kein Angebot (${KIND_DE[q.kind] ?? q.kind}).`);
      need(ctx, "invoices", "edit");
      try {
        const order = await createOrderFromQuote(ctx.workspaceId, q.id, ctx.actor, { customerOrderRef: a.customerOrderRef ?? null });
        return { created: true, orderId: order.id, number: order.number, quote: q.number, status: order.status };
      } catch (e) {
        if (e instanceof DocumentFlowError) throw new McpToolError(e.message);
        throw e;
      }
    },
  }),
  tool({
    name: "send_document",
    title: "Beleg per E-Mail senden (mit Freigabe)",
    description:
      "Bereitet den Versand eines Angebots, einer Auftragsbestätigung oder Rechnung (mit PDF) an den Kunden vor. Er wird NICHT sofort versendet, sondern landet im Freigabe-Eingang; erst ein Mensch gibt ihn frei." + DATA_NOTE,
    access: "approval",
    perm: { object: "invoices", action: "edit" },
    input: z.object({
      document: idArg.describe("Beleg-ID oder Nummer (AN-…, AB-…, RE-…)"),
      withAcceptLink: z.boolean().default(false).describe("Bei Angeboten: Link zur Online-Annahme anhängen"),
    }),
    run: async (a, ctx) => {
      const doc = await findDocument(ctx.workspaceId, a.document);
      need(ctx, "invoices", "edit");
      if (doc.status === "CANCELLED") throw new McpToolError(`${doc.number} ist storniert.`);
      const to = doc.buyerEmail ?? doc.contact?.email ?? null;
      if (!to) throw new McpToolError(`${doc.number} hat keine Empfänger-Adresse.`);
      const label = `${KIND_DE[doc.kind] ?? "Beleg"} ${doc.number}`;
      const appr = await requestApproval({
        workspaceId: ctx.workspaceId,
        kind: "document.send",
        title: `${label} an ${to} senden`,
        summary: `Versand mit PDF, angefragt über MCP.${a.withAcceptLink && doc.kind === "QUOTE" ? " Mit Link zur Online-Annahme." : ""}`,
        payload: { invoiceId: doc.id, withAcceptLink: a.withAcceptLink && doc.kind === "QUOTE" },
        requestedBy: ctx.actor,
      });
      return { status: "wartet_auf_freigabe", approvalId: appr.id, link: approvalLink(appr.id), document: label };
    },
  }),
];
