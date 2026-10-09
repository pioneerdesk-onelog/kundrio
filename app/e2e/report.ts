// Erzeugt das Testprotokoll (deutsch) aus Playwright-Ergebnissen, Monitor und Konsistenzprüfung.
//   docs/Testprotokoll <JJJJ-MM-TT>.md
import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

try { process.loadEnvFile(path.join(__dirname, "../.env")); } catch { /* optional */ }
const OUT = path.join(__dirname, "out");
const read = <T>(f: string, fb: T): T => (existsSync(path.join(OUT, f)) ? (JSON.parse(readFileSync(path.join(OUT, f), "utf8")) as T) : fb);

type PwResult = { status: string; duration: number; error?: { message?: string }; attachments?: { name: string; path?: string }[] };
type PwTest = { annotations?: { type: string; description?: string }[]; results: PwResult[]; status?: string };
type PwSpec = { title: string; file: string; line: number; tests: PwTest[] };
type PwSuite = { title: string; file?: string; specs?: PwSpec[]; suites?: PwSuite[] };

function flatten(s: PwSuite, acc: PwSpec[] = []) {
  for (const sp of s.specs ?? []) acc.push(sp);
  for (const c of s.suites ?? []) flatten(c, acc);
  return acc;
}

type MonitorSample = {
  outbox?: { open?: number; oldestAgeSec?: number; failed?: number };
  jobs?: unknown; runs?: unknown; approvals?: unknown; mails?: unknown; audits?: number;
  health?: { status?: number };
};

const SUITES: Record<string, string> = {
  a: "Anmeldung & Konto", b: "Rollen-Sichtbarkeit & Reichweite", c: "Kernobjekte & Datenfluss", d: "Formulare, DOI, Abmeldung",
  e: "Kampagnen", f: "Landingpages & Analytics-Erfassung", g: "Prozesse & Freigaben", h: "Wissen, Wiki, KI-Antwort",
  i: "Angebote & Rechnungen", j: "API, MCP, OAuth", k: "Übersichten & Berichte", l: "Benutzer-Einladungen", m: "Lexware Office",
};
const icon = (st: string) => (st === "passed" ? "✅" : st === "skipped" ? "⏭" : st === "flaky" ? "⚠️" : "❌");
const clean = (s = "") => s.replace(/\u001b\[[0-9;]*m/g, "").replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();

export function buildReport() {
  const pw = read<{ suites?: PwSuite[]; stats?: { expected: number; unexpected: number; skipped: number; flaky: number; duration: number } }>("results.json", {});
  const specs = (pw.suites ?? []).flatMap((s) => flatten(s));
  const rows = specs.map((sp) => {
    const t = sp.tests[0];
    const r = t?.results.at(-1);
    const status = r?.status ?? t?.status ?? "skipped";
    const letter = path.basename(sp.file)[0];
    const belege = (t?.annotations ?? []).filter((a) => a.type === "beleg" || a.type === "hinweis").map((a) => a.description ?? "");
    const skipReason = (t?.annotations ?? []).find((a) => a.type === "skip")?.description;
    const shots = (r?.attachments ?? []).filter((a) => a.name === "screenshot" && a.path).map((a) => path.relative(path.join(__dirname, "../.."), a.path!));
    return { letter, title: sp.title, file: `${path.basename(sp.file)}:${sp.line}`, status, ms: r?.duration ?? 0, error: clean(r?.error?.message).slice(0, 300), belege, skipReason, shots };
  });

  const monitor = existsSync(path.join(OUT, "monitor.jsonl"))
    ? readFileSync(path.join(OUT, "monitor.jsonl"), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as MonitorSample)
    : [];
  const consistency = read<{ name: string; ok: boolean; detail: string }[]>("consistency.json", []);

  let commit = "unbekannt";
  try { commit = execSync("git log -1 --format='%h %s'", { cwd: __dirname }).toString().trim(); } catch { /* */ }
  const date = new Date().toISOString().slice(0, 10);
  const passed = rows.filter((r) => r.status === "passed").length;
  const failed = rows.filter((r) => !["passed", "skipped"].includes(r.status));
  const skipped = rows.filter((r) => r.status === "skipped").length;

  const md: string[] = [];
  md.push(`# Testprotokoll Kundrio – ${date}`, "");
  md.push(`> Automatischer Abnahmetest (Playwright, Hintergrund-Monitor, Konsistenzprüfung). Testmandant „E2E Testmandant“ (slug \`e2e\`), fiktive Daten unter example.*; echte Adressen nur aus \`E2E_INTERNAL_EMAIL\` / \`E2E_CUSTOMER_EMAIL\`.`, "");
  md.push("## Umgebung", "", "| | |", "|---|---|");
  md.push(`| Commit | ${commit} |`, `| Basis-URL | ${process.env.E2E_BASE_URL ?? "http://127.0.0.1:3100"} |`, `| Chat-Modell | ${process.env.OLLAMA_CHAT_MODEL ?? "–"} |`, `| Embedding | ${process.env.OLLAMA_EMBED_MODEL ?? "–"} |`, `| Mail-Modus | ${process.env.MAIL_MODE ?? "capture"} |`, `| Dauer | ${Math.round((pw.stats?.duration ?? 0) / 1000)} s |`, "");
  md.push("## Ergebnis", "", `**${passed} bestanden · ${failed.length} fehlgeschlagen · ${skipped} übersprungen** (von ${rows.length})`, "");

  md.push("## Testmatrix", "");
  for (const [k, name] of Object.entries(SUITES)) {
    const rs = rows.filter((r) => r.letter === k);
    if (!rs.length) { md.push(`### ${k} · ${name}`, "", "_nicht ausgeführt_", ""); continue; }
    md.push(`### ${k} · ${name}`, "", "| | Prüfung | Dauer | Beleg / Grund |", "|---|---|---|---|");
    for (const r of rs) {
      const info = r.status === "skipped" ? r.skipReason ?? "übersprungen" : r.error ? `**Fehler:** ${r.error}` : r.belege.join("; ");
      md.push(`| ${icon(r.status)} | ${clean(r.title)} | ${(r.ms / 1000).toFixed(1)} s | ${clean(info)} |`);
    }
    md.push("");
  }

  md.push("## Hintergrund-Monitor", "");
  if (monitor.length) {
    const max = (f: (m: MonitorSample) => number | undefined) => Math.max(0, ...monitor.map((m) => f(m) || 0));
    const last = monitor.at(-1)!;
    md.push("| Kennzahl | Wert |", "|---|---|");
    md.push(`| Messpunkte | ${monitor.length} (alle 2 s) |`);
    md.push(`| Outbox: max. offen | ${max((m) => m.outbox?.open)} |`);
    md.push(`| Outbox: max. Alter ältestes Ereignis | ${max((m) => m.outbox?.oldestAgeSec)} s |`);
    md.push(`| Outbox: endgültig fehlgeschlagen (Ende) | ${last.outbox?.failed ?? "–"} |`);
    md.push(`| Jobs (Ende) | ${JSON.stringify(last.jobs ?? {})} |`);
    md.push(`| Prozessläufe (Ende) | ${JSON.stringify(last.runs ?? {})} |`);
    md.push(`| Freigaben (Ende) | ${JSON.stringify(last.approvals ?? {})} |`);
    md.push(`| E-Mails nach Status (Ende) | ${JSON.stringify(last.mails ?? {})} |`);
    md.push(`| Audit-Einträge im Lauf | ${last.audits ?? 0} |`);
    const unhealthy = monitor.filter((m) => m.health?.status !== 200).length;
    md.push(`| Health-Check nicht OK | ${unhealthy} von ${monitor.length} |`, "");
  } else md.push("_kein Monitor-Lauf_", "");

  md.push("## Konsistenzprüfungen", "");
  if (consistency.length) {
    md.push("| | Prüfung | Ergebnis |", "|---|---|---|");
    for (const c of consistency) md.push(`| ${c.ok ? "✅" : "❌"} | ${c.name} | ${c.detail} |`);
    md.push("");
  } else md.push("_nicht ausgeführt_", "");

  md.push("## Mail-Zustellung in echte Postfächer", "", "Manuell bzw. über Postfach-Konnektoren zu prüfen (Versand nur an Freigabeliste):", "");
  md.push("| Mail | Google (intern) | Microsoft (Kundin) | Spam? | Header SPF/DKIM/DMARC |", "|---|---|---|---|---|");
  for (const m of ["Double-Opt-in", "Kampagne (Newsletter)", "Transaktionsmail (API)", "Einladung", "Abmeldebestätigung", "Prozess-Mail (Eingangsbestätigung)"]) md.push(`| ${m} | ☐ | ☐ | ☐ | ☐ |`);
  md.push("");

  md.push("## Gefundene Fehler", "");
  if (failed.length) for (const f of failed) md.push(`- **${clean(f.title)}** (\`e2e/tests/${f.file}\`): ${f.error || f.status}${f.shots.length ? ` – Screenshot: \`${f.shots[0]}\`` : ""}`);
  else md.push("_keine_");
  md.push("");

  // Dokumentierte Fehleranalyse (bleibt über Läufe hinweg erhalten)
  const fixes = path.join(__dirname, "fehlerbehebung.md");
  if (existsSync(fixes)) md.push(readFileSync(fixes, "utf8").trim(), "");

  md.push("## Nicht lokal testbar", "");
  md.push("- Bounce-/Beschwerde-Rückmeldungen des Versand-Relays (brauchen öffentlichen HTTPS-Endpunkt `/api/mail/events/brevo`).");
  md.push("- OAuth-Verbindung über claude.ai-/ChatGPT-Konnektoren (Issuer muss öffentlich per HTTPS erreichbar sein).");
  md.push("- Öffentliche Domains für Landingpages (robots.txt/llms.txt im Domain-Root), KI-Bot-Besuche aus dem Internet.");
  md.push("- Zustellbarkeit (Spam-Einstufung) hängt vom Relay und DNS (SPF/DKIM/DMARC) der Absender-Domain ab.");
  md.push("", "---", `Erzeugt von \`app/e2e/report.ts\`. Rohdaten: \`app/e2e/out/\` (results.json, monitor.jsonl, consistency.json, html/).`);

  const file = path.join(__dirname, "../../docs", `Testprotokoll ${date}.md`);
  writeFileSync(file, md.join("\n") + "\n");
  return { file, passed, failed: failed.length, skipped, total: rows.length };
}

if (require.main === module) console.log(JSON.stringify(buildReport()));
