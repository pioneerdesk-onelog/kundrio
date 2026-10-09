// Startet App (next dev) und Hintergrund-Worker gemeinsam. Strg+C beendet beide.
import { spawn } from "node:child_process";

const procs = [
  ["app", "npm", ["run", "dev"]],
  ["worker", "npm", ["run", "worker"]],
].map(([name, cmd, args]) => {
  const p = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], env: process.env });
  const prefix = (line) => `[${name}] ${line}`;
  for (const stream of [p.stdout, p.stderr]) {
    stream.setEncoding("utf8");
    stream.on("data", (d) => process.stdout.write(d.split("\n").filter(Boolean).map(prefix).join("\n") + "\n"));
  }
  p.on("exit", (code) => {
    console.log(prefix(`beendet (${code})`));
    for (const other of procs) if (other !== p && !other.killed) other.kill("SIGTERM");
  });
  return p;
});

const stop = () => procs.forEach((p) => p.kill("SIGTERM"));
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
