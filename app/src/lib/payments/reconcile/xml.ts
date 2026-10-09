// Minimaler, sicherer XML-Leser für Kontoauszüge (CAMT). Keine DTDs/Entitäten (Schutz vor XXE/Billion Laughs):
// <!DOCTYPE …> wird abgelehnt, nur die fünf Standard-Entitäten und numerische Zeichenreferenzen werden aufgelöst.
// Namensraum-Präfixe werden entfernt (camt:Ntry → Ntry).

export type XmlNode = { name: string; attrs: Record<string, string>; children: XmlNode[]; text: string };

export class XmlError extends Error {}

const ENT: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decode(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-z]+);/g, (m, e: string) => {
    if (e.startsWith("#x")) return String.fromCodePoint(parseInt(e.slice(2), 16));
    if (e.startsWith("#")) return String.fromCodePoint(parseInt(e.slice(1), 10));
    return ENT[e] ?? m;
  });
}

const local = (n: string) => n.slice(n.indexOf(":") + 1);

export function parseXml(xml: string, maxBytes = 20 * 1024 * 1024): XmlNode {
  if (xml.length > maxBytes) throw new XmlError("Datei zu groß.");
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new XmlError("DTD/Entitäten sind nicht erlaubt.");
  const root: XmlNode = { name: "#root", attrs: {}, children: [], text: "" };
  const stack: XmlNode[] = [root];
  let i = 0;
  const n = xml.length;
  while (i < n) {
    const lt = xml.indexOf("<", i);
    if (lt === -1) break;
    if (lt > i) stack[stack.length - 1].text += decode(xml.slice(i, lt));
    if (xml.startsWith("<?", lt)) {
      const end = xml.indexOf("?>", lt);
      if (end === -1) throw new XmlError("Ungültiges XML.");
      i = end + 2;
    } else if (xml.startsWith("<!--", lt)) {
      const end = xml.indexOf("-->", lt);
      if (end === -1) throw new XmlError("Ungültiges XML.");
      i = end + 3;
    } else if (xml.startsWith("<![CDATA[", lt)) {
      const end = xml.indexOf("]]>", lt);
      if (end === -1) throw new XmlError("Ungültiges XML.");
      stack[stack.length - 1].text += xml.slice(lt + 9, end);
      i = end + 3;
    } else if (xml[lt + 1] === "/") {
      const end = xml.indexOf(">", lt);
      if (end === -1) throw new XmlError("Ungültiges XML.");
      const name = local(xml.slice(lt + 2, end).trim());
      const cur = stack.pop();
      if (!cur || cur.name !== name || stack.length === 0) throw new XmlError(`Ungültiges XML (unerwartetes </${name}>).`);
      i = end + 1;
    } else {
      // Start-Tag; Attributwerte können ">" enthalten → Anführungszeichen beachten
      let j = lt + 1;
      let quote: string | null = null;
      while (j < n) {
        const c = xml[j];
        if (quote) {
          if (c === quote) quote = null;
        } else if (c === '"' || c === "'") quote = c;
        else if (c === ">") break;
        j++;
      }
      if (j >= n) throw new XmlError("Ungültiges XML.");
      let inner = xml.slice(lt + 1, j);
      const selfClose = inner.endsWith("/");
      if (selfClose) inner = inner.slice(0, -1);
      const m = /^([^\s/>]+)/.exec(inner);
      if (!m) throw new XmlError("Ungültiges XML.");
      const node: XmlNode = { name: local(m[1]), attrs: {}, children: [], text: "" };
      for (const a of inner.slice(m[1].length).matchAll(/([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g)) node.attrs[local(a[1])] = decode(a[3] ?? a[4] ?? "");
      stack[stack.length - 1].children.push(node);
      if (stack.length > 64) throw new XmlError("XML zu tief verschachtelt.");
      if (!selfClose) stack.push(node);
      i = j + 1;
    }
  }
  if (stack.length !== 1) throw new XmlError("Ungültiges XML (nicht geschlossene Elemente).");
  return root;
}

/** Erstes Kind-Element über einen Pfad, z. B. child(n, "Acct", "Id", "IBAN"). */
export function child(node: XmlNode | undefined, ...path: string[]): XmlNode | undefined {
  let cur = node;
  for (const p of path) {
    cur = cur?.children.find((c) => c.name === p);
    if (!cur) return undefined;
  }
  return cur;
}

export function children(node: XmlNode | undefined, name: string): XmlNode[] {
  return node?.children.filter((c) => c.name === name) ?? [];
}

export function text(node: XmlNode | undefined, ...path: string[]): string | undefined {
  const t = child(node, ...path)?.text.trim();
  return t ? t : undefined;
}

/** Alle Nachfahren mit Namen (Tiefensuche). */
export function findAll(node: XmlNode | undefined, name: string, out: XmlNode[] = []): XmlNode[] {
  for (const c of node?.children ?? []) {
    if (c.name === name) out.push(c);
    findAll(c, name, out);
  }
  return out;
}
