"use server";

import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { checkAuthorizeRequest, buildRedirect, type AuthorizeParams } from "@/lib/oauth/authorize";
import { createAuthorizationCode } from "@/lib/oauth/grants";
import { SCOPE_READ, SCOPE_WRITE } from "@/lib/oauth/config";
import { getAccess } from "@/lib/permissions";

const FIELDS = ["client_id", "redirect_uri", "response_type", "code_challenge", "code_challenge_method", "scope", "state", "resource"] as const;

/** Zustimmung oder Ablehnung. Alle Parameter werden serverseitig erneut geprüft (versteckte Felder sind nicht vertrauenswürdig). */
export async function decide(formData: FormData) {
  const user = await requireUser();
  const p: AuthorizeParams = {};
  for (const f of FIELDS) {
    const v = formData.get(f);
    if (typeof v === "string" && v !== "") p[f] = v;
  }
  const check = await checkAuthorizeRequest(p);
  if (check.kind === "fatal") throw new Error(check.message);
  if (check.kind === "redirect_error") redirect(check.url);

  if (formData.get("decision") !== "allow") {
    await audit({ actor: `user:${user.id}`, action: "oauth.denied", target: check.client.clientId });
    redirect(buildRedirect(check.redirectUri, { error: "access_denied", error_description: "Vom Benutzer abgelehnt", state: check.state }));
  }

  const workspaceId = String(formData.get("workspaceId") ?? "");
  if (!workspaceId || !(await getAccess(user.id, workspaceId))) throw new Error("Kein Zugriff auf diesen Sub-Account.");
  const wantWrite = formData.get("access") === "write" && check.requestedScopes.includes(SCOPE_WRITE);
  const scopes = wantWrite ? [SCOPE_READ, SCOPE_WRITE] : [SCOPE_READ];

  const code = await createAuthorizationCode({
    client: check.client,
    userId: user.id,
    workspaceId,
    scopes,
    redirectUri: check.redirectUri,
    codeChallenge: check.codeChallenge,
    resource: check.resource,
  });
  await audit({ workspaceId, actor: `user:${user.id}`, action: "oauth.authorized", target: check.client.clientId, detail: { scopes } });
  redirect(buildRedirect(check.redirectUri, { code, state: check.state }));
}
