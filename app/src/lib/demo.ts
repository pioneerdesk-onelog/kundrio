// Öffentliche Demo-Instanz (demo.kundrio.de): Anmeldung mit Kurzname statt E-Mail, Gastkonto geschützt.
// DEMO_GUEST="guest:guest@demo.kundrio.de" – nur in der Demo setzen, nie in Produktion.

export function demoGuest(env: Record<string, string | undefined> = process.env) {
  const raw = env.DEMO_GUEST?.trim();
  if (!raw) return null;
  const i = raw.indexOf(":");
  if (i < 1) return null;
  const alias = raw.slice(0, i).trim().toLowerCase();
  const email = raw.slice(i + 1).trim().toLowerCase();
  return alias && email.includes("@") ? { alias, email } : null;
}

/** Anmeldename → E-Mail. Ohne Demo oder bei anderem Namen unverändert. */
export function resolveLoginName(input: string, env?: Record<string, string | undefined>) {
  const v = input.trim().toLowerCase();
  const g = demoGuest(env);
  return g && v === g.alias ? g.email : v;
}

/** Das Gastkonto der Demo darf niemand sperren, herabstufen oder mit neuem Passwort versehen. */
export function isDemoGuest(email: string, env?: Record<string, string | undefined>) {
  const g = demoGuest(env);
  return !!g && email.toLowerCase() === g.email;
}
