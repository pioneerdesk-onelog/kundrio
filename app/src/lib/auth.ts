import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { db } from "./db";
import { env } from "./env";

const COOKIE = "pd_session";
const TTL_MS = 14 * 24 * 3600 * 1000;

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export async function createSession(userId: string) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + TTL_MS);
  await db.session.create({ data: { tokenHash: sha256(token), userId, expiresAt } });
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.appUrl().startsWith("https://"),
    path: "/",
    expires: expiresAt,
  });
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) await db.session.deleteMany({ where: { tokenHash: sha256(token) } });
  jar.delete(COOKIE);
}

/** Aktuell angemeldeter Benutzer oder null. */
export const getCurrentUser = cache(async () => {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  const session = await db.session.findUnique({
    where: { tokenHash: sha256(token) },
    include: { user: { include: { memberships: true } } },
  });
  // Deaktivierte Benutzer (bzw. nicht angenommene Einladungen) gelten als abgemeldet
  if (!session || session.expiresAt < new Date() || !session.user.active) return null;
  return session.user;
});

export type CurrentUser = NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>;

export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

export function canAccessWorkspace(user: CurrentUser, workspaceId: string) {
  if (!user.active) return false;
  const agency = user.agencyRole === "owner" || user.agencyRole === "admin" || user.isAgencyAdmin;
  return agency || user.memberships.some((m) => m.workspaceId === workspaceId);
}

/** Agentur-Inhaber oder -Admin (sieht alle Sub-Accounts). Feinere Rechte: src/lib/permissions. */
export function isAgencyStaffUser(user: Pick<CurrentUser, "agencyRole" | "isAgencyAdmin">) {
  return user.agencyRole === "owner" || user.agencyRole === "admin" || user.isAgencyAdmin;
}

export async function requireAgencyAdmin(): Promise<CurrentUser> {
  const user = await requireUser();
  if (!isAgencyStaffUser(user)) redirect("/");
  return user;
}
