// Verteiler-Takt ohne festen Deckel: weiterverteilen, solange volle Stapel kommen (Belastungstest LR-1).
// Bewusst ohne DB-Import (testbar); der Worker übergibt dispatchEvents aus engine.ts.

export type DispatchResult = { processed: number; started: number; failed: number };

export async function drainEvents(
  dispatch: (limit: number) => Promise<DispatchResult>,
  opts: { batch?: number; budgetMs?: number; clock?: () => number; shouldStop?: () => boolean } = {},
): Promise<DispatchResult & { rounds: number }> {
  const batch = opts.batch ?? 200;
  const budgetMs = opts.budgetMs ?? 10_000;
  const clock = opts.clock ?? Date.now;
  const start = clock();
  const sum = { processed: 0, started: 0, failed: 0, rounds: 0 };
  for (;;) {
    const r = await dispatch(batch);
    sum.processed += r.processed;
    sum.started += r.started;
    sum.failed += r.failed;
    sum.rounds++;
    // Nicht voll → Outbox leer; Fehler → erst im nächsten Takt erneut (Abstand zwischen Wiederholungen bleibt)
    if (r.processed < batch || r.failed > 0) break;
    if (clock() - start >= budgetMs || opts.shouldStop?.()) break;
  }
  return sum;
}
