"use server";

import { revalidatePath } from "next/cache";
import { requireAgencyAdmin } from "@/lib/auth";
import { saveRates, writeSnapshots } from "@/lib/usage";
import { costRatesSchema, type CostRates } from "@/lib/usage-cost";

export type RatesState = { ok?: string; error?: string };

/** Deutsche Zahleneingabe („0,45“) lesen; leer = nicht gesetzt (null). */
function eur(fd: FormData, name: string): number | null {
  const raw = String(fd.get(name) ?? "").trim().replace(/\s/g, "").replace(",", ".");
  if (raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : NaN;
}

export async function saveRatesAction(_prev: RatesState, fd: FormData): Promise<RatesState> {
  await requireAgencyAdmin();
  const candidate: CostRates = {
    dbEurPerGbMonth: eur(fd, "dbEurPerGbMonth"),
    objectEurPerGbMonth: eur(fd, "objectEurPerGbMonth"),
    emailEurPer1000: eur(fd, "emailEurPer1000"),
    aiProfile: String(fd.get("aiProfile")) as CostRates["aiProfile"],
    ai: {
      local: { inEurPer1M: eur(fd, "ai.local.in"), outEurPer1M: eur(fd, "ai.local.out") },
      stackit: { inEurPer1M: eur(fd, "ai.stackit.in"), outEurPer1M: eur(fd, "ai.stackit.out") },
      infercom: { inEurPer1M: eur(fd, "ai.infercom.in"), outEurPer1M: eur(fd, "ai.infercom.out") },
    },
    computeEurPerMonth: eur(fd, "computeEurPerMonth"),
    backupEurPerMonth: eur(fd, "backupEurPerMonth"),
    monitoringEurPerMonth: eur(fd, "monitoringEurPerMonth"),
    fixedAllocation: String(fd.get("fixedAllocation")) as CostRates["fixedAllocation"],
  };
  const parsed = costRatesSchema.safeParse(candidate);
  if (!parsed.success) return { error: "Bitte nur Zahlen ≥ 0 eintragen (Komma oder Punkt), leer lassen = noch unbekannt." };
  await saveRates(parsed.data);
  revalidatePath("/kosten");
  return { ok: "Kostensätze gespeichert." };
}

export async function measureNowAction() {
  await requireAgencyAdmin();
  await writeSnapshots();
  revalidatePath("/kosten");
}
