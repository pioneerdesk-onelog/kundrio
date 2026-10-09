import type { Prisma } from "@prisma/client";
import { invoicePrefix, nextNumber, type DocKind } from "../invoice";

/** Nächste Belegnummer atomar vergeben (Advisory-Lock je Sub-Account, Art und Jahr): AN-/AB-/RE-JJJJ-0001. */
export async function allocateNumber(tx: Prisma.TransactionClient, workspaceId: string, kind: DocKind, year: number) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`invoice:${workspaceId}:${kind}:${year}`}))`;
  const last = await tx.invoice.findFirst({
    where: { workspaceId, kind, number: { startsWith: invoicePrefix(kind, year) } },
    orderBy: { number: "desc" },
    select: { number: true },
  });
  return nextNumber(kind, year, last?.number ?? null);
}
