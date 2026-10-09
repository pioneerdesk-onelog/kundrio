// Prüfungen für Firmendaten und Barrierefreiheit (reine Funktionen, testbar).

export function normalizeIban(iban: string) {
  return iban.replace(/\s+/g, "").toUpperCase();
}

/** IBAN-Prüfung nach ISO 13616 (Mod-97). */
export function isValidIban(input: string): boolean {
  const iban = normalizeIban(input);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return false;
  if (iban.startsWith("DE") && iban.length !== 22) return false;
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let rem = 0;
  for (const ch of rearranged) {
    const v = /[A-Z]/.test(ch) ? String(ch.charCodeAt(0) - 55) : ch;
    for (const d of v) rem = (rem * 10 + Number(d)) % 97;
  }
  return rem === 1;
}

export function formatIban(input: string) {
  return normalizeIban(input).replace(/(.{4})/g, "$1 ").trim();
}

export function isValidBic(bic: string) {
  return /^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(bic.replace(/\s+/g, "").toUpperCase());
}

/** Format der USt-IdNr. (nur Format, keine Online-Prüfung beim BZSt/VIES). */
export function isValidVatId(vat: string) {
  const v = vat.replace(/\s+/g, "").toUpperCase();
  if (v.startsWith("DE")) return /^DE\d{9}$/.test(v);
  if (v.startsWith("AT")) return /^ATU\d{8}$/.test(v);
  return /^[A-Z]{2}[A-Z0-9+*]{2,12}$/.test(v);
}

function channel(c: number) {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(hex: string) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) throw new Error("Farbe als #rrggbb");
  const n = parseInt(m[1], 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

/** Kontrastverhältnis nach WCAG 2.x (1–21). */
export function contrastRatio(a: string, b: string) {
  const [l1, l2] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

/** https-Origin ohne Pfad, z. B. https://onelog.pro */
export function normalizeOrigin(input: string): string | null {
  try {
    const u = new URL(input.trim());
    if (u.protocol !== "https:" || u.username || u.password) return null;
    if (u.pathname !== "/" || u.search || u.hash) return null;
    return u.origin;
  } catch {
    return null;
  }
}
