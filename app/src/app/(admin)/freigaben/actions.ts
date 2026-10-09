"use server";

import "@/lib/approval-kinds";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { getAccess, hasSpecial } from "@/lib/permissions";
import { fourEyesBlocks } from "@/lib/permissions/rules";
import { decideApproval } from "@/lib/approvals";

const q = (s: string) => encodeURIComponent(s.slice(0, 300));

export async function decide(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get("id") ?? "");
  const decision = formData.get("decision") === "approved" ? "approved" : "rejected";
  const a = await db.approval.findUnique({ where: { id }, select: { workspaceId: true, title: true, requestedBy: true, workspace: { select: { fourEyes: true } } } });
  const access = a ? await getAccess(user.id, a.workspaceId) : null;
  if (!a || !access || !hasSpecial(access, "approve")) redirect(`/freigaben?fehler=${q("Freigabe nicht gefunden oder keine Berechtigung.")}`);
  if (fourEyesBlocks(a.workspace.fourEyes, a.requestedBy, user.id)) {
    redirect(`/freigaben?fehler=${q("Vier-Augen-Prinzip: Ihre eigene Anfrage muss eine andere Person entscheiden.")}`);
  }
  let msg: string;
  let ok = true;
  try {
    await decideApproval(id, a.workspaceId, decision, `user:${user.id}`);
    msg = decision === "approved" ? `Freigegeben und ausgeführt: ${a.title}` : `Abgelehnt: ${a.title}`;
  } catch (e) {
    ok = false;
    msg = `Nicht ausgeführt: ${e instanceof Error ? e.message : String(e)}`;
  }
  revalidatePath("/freigaben");
  redirect(`/freigaben?${ok ? "ok" : "fehler"}=${q(msg)}`);
}
