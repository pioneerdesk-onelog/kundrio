import "server-only";
import { registerApprovalKind } from "@/lib/approvals";
import { computeAccess } from "@/lib/permissions/core";
import { publishVersion } from "./api";

// Freigabe „Prozess veröffentlichen“: nur mit den Rechten „Freigaben erteilen“ + „Prozesse veröffentlichen“,
// weil die Version Aktionen mit Außenwirkung enthalten kann.
registerApprovalKind("process.publish", "Prozess veröffentlichen", async (payload, ctx) => {
  const processId = String(payload.processId);
  const versionId = String(payload.versionId);
  const actor = ctx.decidedBy.startsWith("user:") ? ctx.decidedBy : `user:${ctx.decidedBy}`;
  const access = await computeAccess(actor.slice(5), ctx.workspaceId);
  if (!access || !access.perms.special.approve || !access.perms.special.publish_processes) {
    throw new Error("Für diese Freigabe fehlen die Rechte „Freigaben erteilen“ und „Prozesse veröffentlichen“.");
  }
  const validation = await publishVersion(ctx.workspaceId, processId, versionId, actor, true);
  return { published: true, external: validation.external };
});
