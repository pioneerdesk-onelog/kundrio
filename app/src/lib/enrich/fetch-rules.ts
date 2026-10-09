// robots.txt – reine Funktionen (testbar ohne Netz).

export type RobotsRules = { disallow: string[]; allow: string[] };

/** Minimaler robots.txt-Parser: Gruppen für unseren User-Agent bzw. „*“. */
export function parseRobots(txt: string, agentToken = "kundrio-enrichment"): RobotsRules {
  const groups: { agents: string[]; disallow: string[]; allow: string[] }[] = [];
  let cur: (typeof groups)[number] | null = null;
  let lastWasAgent = false;
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    if (!line) continue;
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const val = m[2].trim();
    if (key === "user-agent") {
      if (!cur || !lastWasAgent) {
        cur = { agents: [], disallow: [], allow: [] };
        groups.push(cur);
      }
      cur.agents.push(val.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!cur) continue;
    if (key === "disallow" && val) cur.disallow.push(val);
    if (key === "allow" && val) cur.allow.push(val);
  }
  const specific = groups.find((g) => g.agents.some((a) => a !== "*" && agentToken.includes(a)));
  const star = groups.find((g) => g.agents.includes("*"));
  const g = specific ?? star;
  return { disallow: g?.disallow ?? [], allow: g?.allow ?? [] };
}

export function robotsAllows(rules: RobotsRules, path: string): boolean {
  const match = (p: string) => path.startsWith(p.replace(/\*$/, ""));
  const allowLen = Math.max(-1, ...rules.allow.filter(match).map((p) => p.length));
  const disLen = Math.max(-1, ...rules.disallow.filter(match).map((p) => p.length));
  return disLen < 0 || allowLen >= disLen;
}

