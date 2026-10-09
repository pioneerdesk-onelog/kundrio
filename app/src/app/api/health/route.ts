import { db } from "@/lib/db";

// Gesundheitsprüfung für Load Balancer / Kubernetes.
// GET /api/health        → Liveness/Readiness (DB erreichbar)
// GET /api/health?deep=1 → zusätzlich Migrationsstand, Worker-Herzschlag, Outbox-Stau
// Gibt bewusst keine Versionen, Hosts, Fehlermeldungen oder Konfiguration aus.

export const dynamic = "force-dynamic";

const WORKER_STALE_MS = 120_000;

export async function GET(req: Request) {
  const deep = new URL(req.url).searchParams.get("deep") === "1";
  const checks: Record<string, "ok" | "fehlt" | "veraltet" | "stau" | "fehler"> = {};

  try {
    await db.$queryRaw`SELECT 1`;
    checks.datenbank = "ok";
  } catch {
    checks.datenbank = "fehler";
    return Response.json({ status: "fehler", checks }, { status: 503, headers: { "cache-control": "no-store" } });
  }

  if (deep) {
    try {
      const pending = await db.$queryRaw<{ n: bigint }[]>`
        SELECT count(*) AS n FROM "_prisma_migrations" WHERE finished_at IS NULL AND rolled_back_at IS NULL`;
      checks.migrationen = Number(pending[0]?.n ?? 0) === 0 ? "ok" : "fehler";
    } catch {
      checks.migrationen = "fehler";
    }
    const hb = await db.appSetting.findUnique({ where: { key: "worker:heartbeat" } }).catch(() => null);
    const at = (hb?.value as { at?: string } | null)?.at;
    checks.worker = !at ? "fehlt" : Date.now() - new Date(at).getTime() > WORKER_STALE_MS ? "veraltet" : "ok";
    const backlog = await db.crmEvent
      .count({ where: { processedAt: null, createdAt: { lt: new Date(Date.now() - 5 * 60_000) } } })
      .catch(() => -1);
    checks.ereignisse = backlog === -1 ? "fehler" : backlog > 100 ? "stau" : "ok";
  }

  const healthy = Object.values(checks).every((v) => v === "ok");
  return Response.json(
    { status: healthy ? "ok" : "eingeschränkt", checks },
    { status: deep && !healthy ? 503 : 200, headers: { "cache-control": "no-store" } },
  );
}
