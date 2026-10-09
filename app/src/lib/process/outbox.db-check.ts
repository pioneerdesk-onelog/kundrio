// DB-Prüfung Outbox-Abruf (kein vitest – braucht eine Datenbank):
//   npx tsx --conditions=react-server --env-file=.env src/lib/process/outbox.db-check.ts
// Belastungstest 2026-10-07 (LR-2): Der Abruf des nächsten Ereignisses lief über den Primärschlüssel und filterte
// ALLE bereits verarbeiteten Ereignisse (86.651 Zeilen → 8 ms je Ereignis, linear mit der Historie wachsend).
// Prüft per EXPLAIN, dass der Abruf den Index ("processedAt", id) mit Index-Bedingung nutzt.
// Legt 60.000 verarbeitete Ereignisse in einer Transaktion an und rollt alles zurück – hinterlässt keine Daten.
import assert from "node:assert/strict";
import { db } from "../db";
import { claimEventQuery } from "./engine";

class Rollback extends Error {}

type PlanNode = { "Node Type": string; "Index Name"?: string; "Index Cond"?: string; "Rows Removed by Filter"?: number; Plans?: PlanNode[] };
const flat = (n: PlanNode): PlanNode[] => [n, ...(n.Plans ?? []).flatMap(flat)];

async function main() {
  let plan: PlanNode[] = [];
  await db
    .$transaction(
      async (tx) => {
        const ws = await tx.workspace.findFirst({ select: { id: true } });
        assert.ok(ws, "Mindestens ein Sub-Account nötig");
        await tx.$executeRawUnsafe(
          `INSERT INTO "CrmEvent" ("workspaceId",type,"objectType","objectId",data,"createdAt","processedAt")
           SELECT $1, 'contact.created', 'contact', 'x' || g, '{}'::jsonb, now(), now() FROM generate_series(1, 60000) g`,
          ws.id,
        );
        await tx.$executeRawUnsafe(
          `INSERT INTO "CrmEvent" ("workspaceId",type,"objectType","objectId",data,"createdAt") SELECT $1, 'contact.created', 'contact', 'y' || g, '{}'::jsonb, now() FROM generate_series(1, 50) g`,
          ws.id,
        );
        await tx.$executeRawUnsafe(`ANALYZE "CrmEvent"`);
        const q = claimEventQuery();
        const rows = await tx.$queryRawUnsafe<{ "QUERY PLAN": [{ Plan: PlanNode }] }[]>(`EXPLAIN (ANALYZE, FORMAT JSON) ${q.text}`, ...q.values);
        plan = flat(rows[0]["QUERY PLAN"][0].Plan);
        throw new Rollback();
      },
      { timeout: 120_000 },
    )
    .catch((e) => {
      if (!(e instanceof Rollback)) throw e;
    });

  const scan = plan.find((n) => /Index Scan|Bitmap Index Scan|Seq Scan/.test(n["Node Type"]));
  console.log("Plan:", plan.map((n) => `${n["Node Type"]}${n["Index Name"] ? ` (${n["Index Name"]})` : ""}${n["Rows Removed by Filter"] ? ` – ${n["Rows Removed by Filter"]} Zeilen gefiltert` : ""}`).join(" → "));
  assert.ok(scan, "Kein Scan im Plan");
  assert.equal(scan["Index Name"], "CrmEvent_processedAt_id_idx", "Abruf muss den Index (processedAt, id) nutzen");
  assert.match(scan["Index Cond"] ?? "", /processedAt.*IS NULL/, "Index-Bedingung processedAt IS NULL fehlt");
  assert.ok(!plan.some((n) => n["Node Type"] === "Sort"), "Kein zusätzliches Sortieren aller offenen Ereignisse");
  console.log("✅ Outbox-Abruf nutzt den Index – Kosten unabhängig von der Anzahl verarbeiteter Ereignisse");
}

main()
  .catch((e) => {
    console.error("❌", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
