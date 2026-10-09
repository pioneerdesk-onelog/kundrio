// Gesamtlauf: Monitor starten → Playwright → Konsistenz → Protokoll.
//   npm run e2e                 (alle Suiten)
//   npm run e2e -- tests/a-auth.spec.ts tests/k-dashboards.spec.ts
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const dir = __dirname;
const out = path.join(dir, "out");
rmSync(path.join(out, "monitor.jsonl"), { force: true });
mkdirSync(out, { recursive: true });

const tsx = path.join(dir, "../node_modules/.bin/tsx");

// Testmandant frisch aufbauen (idempotent), sonst fehlen Benutzer und Daten
const seed = spawnSync(tsx, ["--env-file=.env", path.join(dir, "../scripts/seed-e2e.ts")], { stdio: "inherit", cwd: path.join(dir, "..") });
if (seed.status !== 0) {
  console.error("Seed fehlgeschlagen – Abbruch.");
  process.exit(1);
}
const monitor = spawn(tsx, [path.join(dir, "monitor.ts")], { stdio: "ignore" });

const args = process.argv.slice(2);
const pw = spawnSync(path.join(dir, "../node_modules/.bin/playwright"), ["test", "-c", path.join(dir, "playwright.config.ts"), ...args], { stdio: "inherit" });

// Nachlauf: Worker die letzten Ereignisse verarbeiten lassen
spawnSync("sleep", ["5"]);
monitor.kill("SIGTERM");

const cons = spawnSync(tsx, [path.join(dir, "consistency.ts")], { stdio: "inherit" });
const rep = spawnSync(tsx, [path.join(dir, "report.ts")], { encoding: "utf8" });
process.stdout.write(rep.stdout ?? "");
writeFileSync(path.join(out, "exit.json"), JSON.stringify({ playwright: pw.status, consistency: cons.status, report: rep.status }));
process.exit(pw.status ?? 1);
