// Zerlegt Text in überlappende Abschnitte, bevorzugt an Absatzgrenzen.
export function chunkText(text: string, maxChars = 1500, overlap = 200): string[] {
  const clean = text.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!clean) return [];
  if (clean.length <= maxChars) return [clean];

  const chunks: string[] = [];
  let carry = ""; // Überlappung aus dem vorigen Abschnitt
  let body = ""; // neuer Inhalt seit dem letzten Abschnitt

  const flush = () => {
    if (!body.trim()) return;
    const chunk = (carry ? carry + "\n\n" : "") + body;
    chunks.push(chunk.trim());
    carry = chunk.length > overlap ? chunk.slice(-overlap) : chunk;
    body = "";
  };

  for (const p of clean.split(/\n\n/)) {
    if (p.length > maxChars - overlap - 4) {
      flush();
      for (let i = 0; i < p.length; i += maxChars - overlap) chunks.push(p.slice(i, i + maxChars).trim());
      carry = p.slice(-overlap);
      continue;
    }
    if (carry.length + body.length + p.length + 4 > maxChars) flush();
    body += (body ? "\n\n" : "") + p;
  }
  flush();
  return chunks;
}
