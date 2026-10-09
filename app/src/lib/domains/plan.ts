import { valueMatches } from "./records";
import type { DesiredRecord, RecordType } from "./types";

// Änderungsplan (Diff) zwischen Soll-Einträgen und den vorhandenen Einträgen der Zone – rein, testbar.
// Regel: nur eigene Einträge anlegen/ändern, nie fremde löschen. Konflikte werden gemeldet, nicht „gelöst“.

export type ZoneRecord = { id?: string; type: RecordType | string; name: string; value: string; ttl?: number };

export type PlanStep =
  | { action: "keep"; desired: DesiredRecord; existing: ZoneRecord; note: string }
  | { action: "create"; desired: DesiredRecord; note: string }
  | { action: "update"; desired: DesiredRecord; existing: ZoneRecord; newValue: string; note: string }
  | { action: "conflict"; desired: DesiredRecord; existing: ZoneRecord[]; note: string };

const same = (a: string, b: string) => a.toLowerCase().replace(/\.$/, "") === b.toLowerCase().replace(/\.$/, "");

/** SPF ergänzen: include vor dem abschließenden all-Mechanismus einfügen. */
export function mergeSpf(existing: string, include: string): string {
  if (existing.toLowerCase().includes(`include:${include.toLowerCase()}`)) return existing;
  const m = existing.match(/\s([~\-?+]?all)\s*$/i);
  return m ? `${existing.slice(0, m.index)} include:${include} ${m[1]}` : `${existing.trim()} include:${include}`;
}

export function planChanges(desired: DesiredRecord[], zone: ZoneRecord[]): PlanStep[] {
  return desired.map((d): PlanStep => {
    const atName = zone.filter((r) => same(r.name, d.name));
    const sameType = atName.filter((r) => r.type.toUpperCase() === d.type);

    if (d.type === "CNAME") {
      const others = atName.filter((r) => r.type.toUpperCase() !== "CNAME");
      if (others.length) return { action: "conflict", desired: d, existing: others, note: `Unter ${d.name} gibt es bereits ${others.map((o) => o.type).join(", ")}-Einträge. Ein CNAME darf nicht daneben stehen – bitte zuerst entfernen oder einen anderen Hostnamen wählen.` };
      if (sameType[0]) {
        return valueMatches(d, sameType[0].value)
          ? { action: "keep", desired: d, existing: sameType[0], note: "bereits korrekt" }
          : { action: "update", desired: d, existing: sameType[0], newValue: d.value, note: `CNAME zeigt auf ${sameType[0].value} → wird auf ${d.value} geändert` };
      }
      return { action: "create", desired: d, note: "neu anlegen" };
    }

    if (d.type === "TXT") {
      if (d.purpose === "spf") {
        const spf = sameType.find((r) => r.value.trim().toLowerCase().startsWith("v=spf1"));
        if (!spf) return { action: "create", desired: d, note: "SPF neu anlegen" };
        if (valueMatches(d, spf.value)) return { action: "keep", desired: d, existing: spf, note: "SPF enthält die Versandleitung bereits" };
        const inc = d.value.match(/include:(\S+)/)?.[1] ?? "";
        return { action: "update", desired: d, existing: spf, newValue: mergeSpf(spf.value, inc), note: "bestehenden SPF-Eintrag ergänzen (nicht ersetzen)" };
      }
      if (d.purpose === "dmarc") {
        const dm = sameType.find((r) => r.value.trim().toLowerCase().startsWith("v=dmarc1"));
        return dm ? { action: "keep", desired: d, existing: dm, note: "DMARC vorhanden – wird nicht verändert" } : { action: "create", desired: d, note: "DMARC neu anlegen" };
      }
      const exact = sameType.find((r) => valueMatches(d, r.value));
      return exact ? { action: "keep", desired: d, existing: exact, note: "bereits vorhanden" } : { action: "create", desired: d, note: "neu anlegen (vorhandene TXT bleiben unberührt)" };
    }

    // A / AAAA (Domain-Spitze)
    const cname = atName.filter((r) => r.type.toUpperCase() === "CNAME");
    if (cname.length) return { action: "conflict", desired: d, existing: cname, note: "Unter diesem Namen steht ein CNAME – bitte zuerst entfernen." };
    if (sameType.some((r) => valueMatches(d, r.value))) return { action: "keep", desired: d, existing: sameType.find((r) => valueMatches(d, r.value))!, note: "bereits korrekt" };
    if (sameType.length) return { action: "conflict", desired: d, existing: sameType, note: `Die Domain zeigt bereits auf ${sameType.map((r) => r.value).join(", ")} (z. B. bestehende Website). Wir ersetzen das nicht automatisch – Subdomain wählen oder manuell umstellen.` };
    return { action: "create", desired: d, note: "neu anlegen" };
  });
}

export const planIsApplicable = (steps: PlanStep[]) => !steps.some((s) => s.action === "conflict");
export const planHasChanges = (steps: PlanStep[]) => steps.some((s) => s.action === "create" || s.action === "update");
