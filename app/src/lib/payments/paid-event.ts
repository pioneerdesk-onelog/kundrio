import "server-only";
import type { Prisma } from "@prisma/client";
import { emitEvent } from "../events";

// Einheitliches Ereignis „Rechnung bezahlt“ – egal über welchen Weg die Zahlung kam.
// Aufrufer setzt den Status selbst bedingt (updateMany … status notIn PAID) und ruft dies nur bei echter Änderung,
// damit Prozesse genau einmal je Bezahlt-Wechsel starten.

export type PaidVia = "online" | "bank" | "sepa" | "manual" | "lexware";
// Auswahl im Prozess-Editor: PAID_VIA in lib/process/fields.ts

type InvoiceLike = { id: string; workspaceId: string; contactId: string | null; subscriptionId: string | null; grossCents: number; number: string };

export async function emitInvoicePaid(
  tx: Prisma.TransactionClient,
  inv: InvoiceLike,
  source: { via: PaidVia; provider?: string; method?: string | null; paymentId?: string; bankTransactionId?: string; actor?: string },
) {
  await emitEvent(
    {
      workspaceId: inv.workspaceId,
      type: "invoice.paid",
      objectType: "invoice",
      objectId: inv.id,
      data: {
        invoiceId: inv.id, contactId: inv.contactId, subscriptionId: inv.subscriptionId, number: inv.number, grossCents: inv.grossCents,
        via: source.via, provider: source.provider, method: source.method, paymentId: source.paymentId, bankTransactionId: source.bankTransactionId,
      },
    },
    tx,
  );
}
