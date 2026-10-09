"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { createSession, destroySession } from "@/lib/auth";
import { verifyPassword } from "@/lib/password";
import { rateLimitAsync } from "@/lib/ratelimit";
import { clientIp } from "@/lib/client-ip";
import { resolveLoginName } from "@/lib/demo";

export type LoginState = { error?: string };

// Demo: Kurzname (z. B. „guest“) wird vor der Prüfung zur E-Mail-Adresse
const schema = z.object({ email: z.preprocess((v) => resolveLoginName(String(v ?? "")), z.email().max(200)), password: z.string().min(1).max(500) });

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = schema.safeParse({ email: formData.get("email"), password: formData.get("password") });
  const generic = { error: "E-Mail oder Passwort ist falsch." };
  if (!parsed.success) return generic;
  const email = parsed.data.email.toLowerCase();

  const h = await headers();
  const ip = clientIp(h);
  if (!await rateLimitAsync(`login:${ip}`, 20, 15 * 60_000) || !await rateLimitAsync(`login:${email}`, 8, 15 * 60_000)) {
    return { error: "Zu viele Versuche. Bitte in 15 Minuten erneut versuchen." };
  }

  const user = await db.user.findUnique({ where: { email } });
  // Auch ohne Benutzer einen Hash prüfen, damit die Antwortzeit nichts verrät
  const ok = await verifyPassword(
    parsed.data.password,
    user?.passwordHash ?? "scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==",
  );
  // Deaktivierte oder noch nicht angenommene Konten erhalten keine Sitzung (gleiche Meldung, nichts verraten)
  if (!user || !ok || !user.active) return generic;

  await createSession(user.id);
  const next = String(formData.get("next") ?? "/");
  redirect(next.startsWith("/") && !next.startsWith("//") ? next : "/");
}

export async function logout() {
  await destroySession();
  redirect("/login");
}
