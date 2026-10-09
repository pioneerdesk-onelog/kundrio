// Fasst e2e/out/explore/*/befunde.json zusammen:  npx tsx e2e/explore/zusammenfassung.ts [--axe]
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const OUT = path.join(__dirname, "../out/explore");
const showAxe = process.argv.includes("--axe");
const axeTotals = new Map<string, { impact: string; pages: Set<string>; targets: Set<string> }>();

for (const role of readdirSync(OUT)) {
  const f = path.join(OUT, role, "befunde.json");
  if (!existsSync(f)) continue;
  const data = JSON.parse(readFileSync(f, "utf8"));
  console.log(`\n=== ${data.role} (${data.findings.length} Seiten) ===`);
  if (data.tabs) console.log(`Reiter: ${data.tabs.map((t: string) => t.split("/").pop()).join(", ")}`);
  for (const x of data.findings) {
    const notes: string[] = [];
    if (x.status !== 200) notes.push(`HTTP ${x.status}`);
    if (x.denied) notes.push("GESPERRT");
    if (x.english.length) notes.push(`EN: ${x.english.join(",")}`);
    if (x.placeholders.length) notes.push(`PLATZH: ${x.placeholders.join(",")}`);
    if (x.rawNumbers.length) notes.push(`ZAHL: ${x.rawNumbers.join(",")}`);
    if (x.isoDates.length) notes.push(`ISO: ${x.isoDates.join(",")}`);
    if (x.duForm.length) notes.push(`DU: ${x.duForm.join(",")}`);
    if (x.overflowX) notes.push("ÜBERLAUF-X");
    if (x.consoleErrors.length) notes.push(`KONSOLE: ${x.consoleErrors.join(" | ").slice(0, 200)}`);
    if (x.axe?.blocking) notes.push(`AXE ${x.axe.blocking}: ${x.axe.ids.filter((i: string) => /critical|serious/.test(i)).join(",")}`);
    if (notes.length) console.log(`  ${x.file}: ${notes.join(" · ")}`);
    for (const v of x.axe?.violations ?? []) {
      const k = v.id;
      const t = axeTotals.get(k) ?? { impact: v.impact, pages: new Set(), targets: new Set() };
      t.pages.add(`${role}:${x.url}`);
      for (const n of v.nodes) t.targets.add(n.target);
      axeTotals.set(k, t);
    }
  }
}
console.log("\n=== axe gesamt ===");
for (const [id, t] of [...axeTotals].sort((a, b) => b[1].pages.size - a[1].pages.size)) {
  console.log(`${id} (${t.impact}): ${t.pages.size} Seiten`);
  if (showAxe) console.log(`   Ziele: ${[...t.targets].slice(0, 25).join(" | ")}`);
}
