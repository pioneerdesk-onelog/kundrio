import { NextResponse } from "next/server";
import { getCurrentUser, isAgencyStaffUser } from "@/lib/auth";
import { env } from "@/lib/env";
import { FLOW_DAYS, costsFor, loadRates, measureAll } from "@/lib/usage";
import { csvCell } from "@/lib/usage-cost";

export const dynamic = "force-dynamic";

// CSV-Export der aktuellen Messung (nur Agentur-Admins). Semikolon + BOM für Excel (DE).
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(new URL("/login", env.appUrl()));
  if (!isAgencyStaffUser(user)) return new NextResponse("Nicht erlaubt", { status: 403 });

  const [{ measuredAt, workspaces }, rates] = await Promise.all([measureAll(), loadRates()]);
  const costs = costsFor(workspaces, rates);
  const head = [
    "sub_account", "benutzer", "kontakte", "db_bytes", "vektor_bytes", "objekt_bytes",
    `emails_${FLOW_DAYS}t`, "emails_transaktional", "emails_kampagne", "emails_1zu1",
    `ki_aufrufe_${FLOW_DAYS}t`, "tokens_ein", "tokens_aus", "ki_ms", `analytics_${FLOW_DAYS}t`, `jobs_${FLOW_DAYS}t`,
    "kosten_db_eur", "kosten_objekt_eur", "kosten_email_eur", "kosten_ki_ein_eur", "kosten_ki_aus_eur", "fixanteil_eur",
    "kosten_monat_eur", "kosten_je_benutzer_eur",
  ];
  const num = (v: number) => String(v).replace(".", ",");
  const lines = [head.join(";")];
  for (const w of workspaces) {
    const c = costs[w.workspaceId];
    lines.push(
      [
        csvCell(w.slug), w.users, w.rows.Contact ?? 0, w.storage.dbBytes, w.storage.embeddingBytes, w.storage.objectBytes,
        w.emails30d.total, w.emails30d.transactional, w.emails30d.campaign, w.emails30d.one_to_one,
        w.ai30d.calls, w.ai30d.tokensIn, w.ai30d.tokensOut, w.ai30d.ms, w.analyticsEvents30d, w.jobs30d.total,
        num(c.db), num(c.objects), num(c.email), num(c.aiIn), num(c.aiOut), num(c.fixedShare), num(c.total), num(c.perUser),
      ]
        .map((v) => (typeof v === "number" ? String(v) : v))
        .join(";"),
    );
  }
  const body = "﻿" + lines.join("\r\n") + "\r\n";
  const stamp = measuredAt.toISOString().slice(0, 10);
  return new NextResponse(body, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="nutzung-kosten-${stamp}.csv"`,
      "cache-control": "no-store",
    },
  });
}
