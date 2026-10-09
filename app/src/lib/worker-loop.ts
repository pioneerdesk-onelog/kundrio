// Hauptschleife des Workers, fehlertolerant (LR-7): Ein Fehler in einer Runde (z. B. Datenbank-Verbindung kurz weg)
// beendet den Worker nicht mehr, sondern wird protokolliert; danach kurze Pause und weiter. Ohne DB-Import testbar.

export async function runLoop(
  iteration: () => Promise<"busy" | "idle">,
  opts: { shouldStop: () => boolean; sleep?: (ms: number) => Promise<void>; onError: (e: unknown) => void; idleMs?: number; errorMs?: number },
) {
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  while (!opts.shouldStop()) {
    try {
      if ((await iteration()) === "idle") await sleep(opts.idleMs ?? 1000);
    } catch (e) {
      opts.onError(e);
      await sleep(opts.errorMs ?? 2000);
    }
  }
}
