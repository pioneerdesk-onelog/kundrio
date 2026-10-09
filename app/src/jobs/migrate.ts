import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { JobHandler } from "@/lib/jobs";
import { runStep, type StepPayload } from "@/lib/migrate/brevo-import";

export const handlers: Record<string, JobHandler> = {
  // Brevo-Import in Etappen (Felder → Listen → Kontakte → Sperrliste → Vorlagen)
  "migrate.brevo": async (p) => {
    await runStep(p as unknown as StepPayload);
  },
};

// Endgültig gescheitert: verschlüsselten Brevo-Schlüssel sofort aus der Nutzlast entfernen
export async function onJobFailed(jobId: string, payload: Record<string, unknown>) {
  const { key: _key, ...rest } = payload;
  await db.job.update({ where: { id: jobId }, data: { payload: { ...rest, keyRemoved: true } as Prisma.InputJsonValue } });
}
