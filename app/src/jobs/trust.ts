import { promises as dns } from "node:dns";
import { Prisma } from "@prisma/client";
import type { JobHandler } from "@/lib/jobs";
import { db } from "@/lib/db";
import { emailDomain, evaluateTrust, type TrustInput } from "@/lib/trust";

async function hasMx(domain: string, timeoutMs = 5000): Promise<boolean | null> {
  const timeout = new Promise<null>((r) => setTimeout(() => r(null), timeoutMs));
  const lookup = dns
    .resolveMx(domain)
    .then((rows) => rows.some((r) => r.exchange !== "" && r.exchange !== ".")) // Null-MX (RFC 7505) = keine Mails
    .catch((e: NodeJS.ErrnoException) => (e.code === "ENOTFOUND" || e.code === "ENODATA" ? false : null));
  return Promise.race([lookup, timeout]);
}

export const handlers: Record<string, JobHandler> = {
  // MX-Prüfung nachholen und Score neu berechnen
  "trust.score": async (p) => {
    const contact = await db.contact.findUnique({ where: { id: String(p.contactId) } });
    if (!contact?.email) return;
    const domain = emailDomain(contact.email);
    if (!domain) return;
    const mx = await hasMx(domain);
    const prev = (contact.trustSignals ?? {}) as { input?: TrustInput };
    const input: TrustInput = { ...(prev.input ?? {}), email: contact.email, mx };
    const { score, signals } = evaluateTrust(input);
    await db.contact.update({
      where: { id: contact.id },
      data: {
        trustScore: score,
        trustSignals: { input: { ...input, mx: undefined }, mx, signals, checkedAt: new Date().toISOString() } as unknown as Prisma.InputJsonValue,
      },
    });
  },
};
