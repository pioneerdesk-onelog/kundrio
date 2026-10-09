// Reguläre Ausdrücke für Postgres (~*), die eine E-Mail-Adresse oder Rufnummer als GANZES Wort in Adressfeldern finden
// („Name <a@b.de>“, Listen mit Komma) – aber nicht „anna@x.de“ innerhalb von „joanna@x.de“.
export function addrRegex(value: string) {
  const esc = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return `(^|[\\s<,;:"'(])${esc}($|[\\s>,;"')])`;
}
