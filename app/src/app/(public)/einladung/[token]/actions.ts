"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { createSession, getCurrentUser } from "@/lib/auth";
import { hashPassword } from "@/lib/password";
import { clientIp } from "@/lib/client-ip";
import { rateLimitAsync } from "@/lib/ratelimit";
import { acceptInvitation, findOpenInvitation, INVITED_PASSWORD } from "@/lib/invitations";
import type { FormState } from "@/components/users/StateForm";

async function limited() {
  const ip = clientIp(await headers());
  return !(await rateLimitAsync(`invite:${ip}`, 20, 15 * 60_000));
}

/** Neue Person: Name + Passwort setzen, Konto aktivieren, anmelden. */
export async function acceptAsNewUser(token: string, _prev: FormState, fd: FormData): Promise<FormState> {
  if (await limited()) return { error: "Zu viele Versuche. Bitte später erneut versuchen." };
  const parsed = z
    .object({
      name: z.string().trim().min(2, "Bitte Ihren Namen angeben.").max(120),
      password: z.string().min(12, "Das Passwort braucht mindestens 12 Zeichen.").max(200),
      confirm: z.string(),
    })
    .refine((d) => d.password === d.confirm, { message: "Die Passwörter stimmen nicht überein.", path: ["confirm"] })
    .safeParse({ name: fd.get("name"), password: fd.get("password"), confirm: fd.get("confirm") });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const inv = await findOpenInvitation(token);
  if (!inv) return { error: "Die Einladung ist ungültig, abgelaufen oder wurde bereits verwendet." };
  const user = await db.user.findUnique({ where: { email: inv.email } });
  // Nur für noch nicht aktivierte Konten – bestehende Konten müssen sich anmelden
  if (!user || user.passwordHash !== INVITED_PASSWORD) return { error: "Für diese E-Mail-Adresse besteht bereits ein Konto. Bitte melden Sie sich an." };
  try {
    await acceptInvitation(token, { userId: user.id, name: parsed.data.name, passwordHash: await hashPassword(parsed.data.password) });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Annahme fehlgeschlagen." };
  }
  await createSession(user.id);
  redirect(inv.workspace ? `/sa/${inv.workspace.slug}` : "/");
}

/** Bestehendes Konto: angemeldet mit passender E-Mail bestätigt die Einladung. */
export async function acceptAsExistingUser(token: string, _prev: FormState, _fd: FormData): Promise<FormState> {
  if (await limited()) return { error: "Zu viele Versuche. Bitte später erneut versuchen." };
  const me = await getCurrentUser();
  if (!me) return { error: "Bitte zuerst anmelden." };
  let inv;
  try {
    inv = await acceptInvitation(token, { userId: me.id });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Annahme fehlgeschlagen." };
  }
  redirect(inv.workspace ? `/sa/${inv.workspace.slug}` : "/");
}
