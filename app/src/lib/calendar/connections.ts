import "server-only";
import { db } from "../db";
import { open, seal } from "../migrate/secretbox";
import { audit } from "../audit";
import { calendarEnv, type Provider } from "./config";
import { OAuthError, refreshTokens, revokeToken, type TokenSet } from "./oauth";
import { graphMe } from "./graph";

// Kalender-Verbindungen je Benutzer. Tokens liegen nur verschlüsselt in der DB (AES-GCM).

type Stored = { accessToken: string; refreshToken?: string };

export async function accountEmailFromTokens(provider: Provider, t: TokenSet): Promise<string> {
  if (provider === "google") {
    const res = await fetch(calendarEnv.googleUserinfoUrl(), {
      headers: { authorization: `Bearer ${t.accessToken}` },
      signal: AbortSignal.timeout(10_000),
    });
    const data = (await res.json().catch(() => ({}))) as { email?: string };
    if (!res.ok || !data.email) throw new Error("Google-Konto konnte nicht ermittelt werden.");
    return data.email.toLowerCase();
  }
  const me = await graphMe(t.accessToken);
  const email = me.mail ?? me.userPrincipalName;
  if (!email) throw new Error("Microsoft-Konto konnte nicht ermittelt werden.");
  return email.toLowerCase();
}

export async function saveConnection(userId: string, provider: Provider, t: TokenSet, accountEmail: string) {
  const existing = await db.calendarConnection.findUnique({ where: { userId_provider_accountEmail: { userId, provider, accountEmail } } });
  // Google liefert den Refresh-Token nur bei der ersten Zustimmung – vorhandenen behalten
  const prev = existing ? (JSON.parse(open(existing.credentials)) as Stored) : null;
  const stored: Stored = { accessToken: t.accessToken, refreshToken: t.refreshToken ?? prev?.refreshToken };
  const scopes = t.scope ? t.scope.split(/\s+/).filter(Boolean) : [];
  const conn = await db.calendarConnection.upsert({
    where: { userId_provider_accountEmail: { userId, provider, accountEmail } },
    create: { userId, provider, accountEmail, credentials: seal(JSON.stringify(stored)), scopes, tokenExpiresAt: t.expiresAt, status: "active" },
    update: { credentials: seal(JSON.stringify(stored)), scopes: scopes.length ? scopes : undefined, tokenExpiresAt: t.expiresAt, status: "active", lastError: null },
  });
  await audit({ actor: `user:${userId}`, action: "calendar.connected", target: conn.id, detail: { provider } });
  return conn;
}

export type ConnectionRow = Awaited<ReturnType<typeof db.calendarConnection.findFirstOrThrow>>;

/** Gültiges Access-Token (bei Bedarf erneuert). Bei widerrufenem Zugang: Status „reconnect“ + Fehler. */
export async function accessTokenFor(conn: ConnectionRow): Promise<string> {
  if (conn.status !== "active") throw new Error("Kalender-Verbindung muss neu hergestellt werden.");
  const stored = JSON.parse(open(conn.credentials)) as Stored;
  const fresh = conn.tokenExpiresAt && conn.tokenExpiresAt.getTime() - Date.now() > 120_000;
  if (fresh) return stored.accessToken;
  if (!stored.refreshToken) {
    await markReconnect(conn.id, "Kein Refresh-Token vorhanden");
    throw new Error("Kalender-Verbindung muss neu hergestellt werden.");
  }
  try {
    const t = await refreshTokens(conn.provider as Provider, stored.refreshToken);
    const next: Stored = { accessToken: t.accessToken, refreshToken: t.refreshToken ?? stored.refreshToken };
    await db.calendarConnection.update({
      where: { id: conn.id },
      data: { credentials: seal(JSON.stringify(next)), tokenExpiresAt: t.expiresAt, lastError: null },
    });
    return t.accessToken;
  } catch (e) {
    if (e instanceof OAuthError && (e.code === "invalid_grant" || e.code === "interaction_required")) {
      await markReconnect(conn.id, "Zugang widerrufen oder abgelaufen");
    }
    throw e;
  }
}

export async function markReconnect(id: string, reason: string) {
  await db.calendarConnection.update({ where: { id }, data: { status: "reconnect", lastError: reason.slice(0, 300) } });
}

export async function activeConnection(userId: string, provider: Provider) {
  return db.calendarConnection.findFirst({ where: { userId, provider, status: "active" }, orderBy: { updatedAt: "desc" } });
}

export async function disconnect(userId: string, connectionId: string) {
  const conn = await db.calendarConnection.findFirst({ where: { id: connectionId, userId } });
  if (!conn) return;
  try {
    const stored = JSON.parse(open(conn.credentials)) as Stored;
    await revokeToken(conn.provider as Provider, stored.refreshToken ?? stored.accessToken);
  } catch {
    // Widerruf ist best effort; die Verbindung wird trotzdem entfernt
  }
  await db.calendarConnection.delete({ where: { id: conn.id } });
  await audit({ actor: `user:${userId}`, action: "calendar.disconnected", target: conn.id, detail: { provider: conn.provider } });
}
