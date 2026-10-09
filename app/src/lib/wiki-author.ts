// Anzeige der Autorschaft im CRM-Wiki. Gespeichert bleibt die genaue Herkunft (z. B. „llm:<modell>“) für
// Nachvollziehbarkeit (AI Act); angezeigt wird ein verständlicher Name statt der technischen Kennung.
export function wikiAuthorLabel(author: string) {
  if (author.startsWith("llm:")) return "KI-Assistent (lokal)";
  if (author === "mensch") return "Team";
  return author;
}
