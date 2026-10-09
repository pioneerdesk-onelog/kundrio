// Barrierefreiheits-Prüfung für Landingpages (WCAG 2.2 AA, Auswahl prüfbarer Regeln).
// Fehler blockieren das Veröffentlichen, Warnungen nicht.
import { safeHref, str, walkBlocks, type PageData } from "./p-tree";

export type A11yIssue = { level: "error" | "warning"; rule: string; message: string; blockId?: string };
export type A11yReport = { ok: boolean; checkedAt: string; errors: number; warnings: number; issues: A11yIssue[] };

export type A11yContext = {
  brandPrimary: string;
  brandAccent: string;
  /** IDs der Formulare dieses Workspaces mit Anzahl Felder */
  forms: Record<string, { fieldCount: number }>;
  /** Freigeschaltete Buchungsseiten dieses Workspaces (/buchen/<ws>/<slug>); fehlt → nur Format prüfen */
  bookingPaths?: string[];
};

const BOOKING_PATH = /^\/buchen\/[a-z0-9-]{1,80}\/[a-z0-9-]{1,60}$/;

// ---- Kontrast nach WCAG 2.x ----
function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}

function luminance([r, g, b]: [number, number, number]) {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function contrastRatio(a: string, b: string): number | null {
  const ra = hexToRgb(a), rb = hexToRgb(b);
  if (!ra || !rb) return null;
  const [l1, l2] = [luminance(ra), luminance(rb)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

/** Textfarbe (weiß oder fast schwarz) mit dem besseren Kontrast auf `bg`. */
export function onColor(bg: string): string {
  const white = contrastRatio(bg, "#ffffff") ?? 0;
  const ink = contrastRatio(bg, "#0e141b") ?? 0;
  return white >= ink ? "#ffffff" : "#0e141b";
}

const GENERIC_LINK = /^(hier|hier klicken|klicken sie hier|mehr|mehr erfahren|weiter|weiterlesen|link|click here|here|more|read more)$/i;

/** Überschriften in Dokumentreihenfolge (Ebene 1–6). */
export function headingOutline(data: PageData): { level: number; text: string; blockId?: string }[] {
  const out: { level: number; text: string; blockId?: string }[] = [];
  for (const b of walkBlocks(data)) {
    const p = b.props;
    const id = str(p.id) || undefined;
    switch (b.type) {
      case "Hero":
        out.push({ level: 1, text: str(p.heading), blockId: id });
        break;
      case "Heading":
        out.push({ level: Number(p.level) === 3 ? 3 : 2, text: str(p.text), blockId: id });
        break;
      case "Features":
      case "FAQ":
      case "CTA":
      case "Form":
      case "Booking":
        if (str(p.heading).trim()) out.push({ level: 2, text: str(p.heading), blockId: id });
        break;
      case "Text":
        for (const m of str(p.markdown).matchAll(/^(#{1,6})\s+(.+)$/gm)) out.push({ level: m[1].length, text: m[2], blockId: id });
        break;
    }
  }
  return out;
}

export function checkPage(data: PageData, ctx: A11yContext): A11yReport {
  const issues: A11yIssue[] = [];
  const err = (rule: string, message: string, blockId?: string) => issues.push({ level: "error", rule, message, blockId });
  const warn = (rule: string, message: string, blockId?: string) => issues.push({ level: "warning", rule, message, blockId });

  const blocks = walkBlocks(data);
  if (blocks.length === 0) err("leer", "Die Seite hat keinen Inhalt.");

  // Überschriften
  const outline = headingOutline(data);
  const h1 = outline.filter((h) => h.level === 1);
  if (h1.length === 0) err("h1", "Es fehlt eine Hauptüberschrift (H1). Fügen Sie einen Hero-Block hinzu.");
  if (h1.length > 1) err("h1", `Es gibt ${h1.length} Hauptüberschriften (H1). Erlaubt ist genau eine.`, h1[1].blockId);
  if (outline[0] && outline[0].level !== 1) warn("h1-zuerst", "Die erste Überschrift sollte die Hauptüberschrift (H1) sein.", outline[0].blockId);
  for (let i = 1; i < outline.length; i++) {
    if (outline[i].level > outline[i - 1].level + 1) {
      err("ueberschriften", `Überschriftenebene übersprungen: H${outline[i - 1].level} → H${outline[i].level} („${outline[i].text}“).`, outline[i].blockId);
    }
  }
  for (const h of outline) if (!h.text.trim()) err("ueberschrift-leer", "Leere Überschrift.", h.blockId);

  for (const b of blocks) {
    const p = b.props;
    const id = str(p.id) || undefined;

    // Bilder
    if (b.type === "Image") {
      const decorative = p.decorative === "yes";
      if (!str(p.src).trim()) err("bild-quelle", "Bild ohne Adresse (URL).", id);
      else if (!/^(https:\/\/|\/)/i.test(str(p.src))) err("bild-quelle", "Bilder nur über https:// oder einen relativen Pfad einbinden.", id);
      else if (/^https:\/\//i.test(str(p.src))) warn("bild-extern", "Externes Bild: Beim Laden geht die IP-Adresse der Besucher an den fremden Server (Datenschutz prüfen).", id);
      if (!decorative && !str(p.alt).trim()) err("bild-alt", "Bild ohne Alternativtext. Beschreiben Sie das Bild oder markieren Sie es als dekorativ.", id);
      if (!decorative && str(p.alt).trim().length > 0 && /^(bild|image|foto|grafik)(\s*\d*)?$/i.test(str(p.alt).trim())) {
        warn("bild-alt", `Alternativtext „${str(p.alt)}“ ist nicht aussagekräftig.`, id);
      }
    }

    // Buttons und Links
    const links: { label: string; href: unknown }[] = [];
    if (b.type === "Hero" || b.type === "CTA") links.push({ label: str(p.buttonLabel), href: p.buttonHref });
    if (b.type === "LinkButton") links.push({ label: str(p.label), href: p.href });
    for (const l of links) {
      const hasHref = str(l.href).trim() !== "";
      if (!hasHref && !l.label.trim()) continue; // Button nicht genutzt
      if (!l.label.trim()) err("link-text", "Button/Link ohne Beschriftung.", id);
      else if (GENERIC_LINK.test(l.label.trim())) warn("link-text", `Beschriftung „${l.label}“ sagt nicht, wohin der Link führt.`, id);
      if (!hasHref) err("link-ziel", `Button „${l.label}“ hat kein Ziel.`, id);
      else if (!safeHref(l.href)) err("link-ziel", `Linkziel von „${l.label}“ ist ungültig oder unsicher.`, id);
    }

    // Formulare
    if (b.type === "Form") {
      const fid = str(p.formId);
      if (!fid) err("formular", "Formular-Block ohne ausgewähltes Formular.", id);
      else if (!ctx.forms[fid]) err("formular", "Das gewählte Formular existiert nicht (mehr).", id);
      else if (ctx.forms[fid].fieldCount === 0) err("formular", "Das gewählte Formular hat keine Felder.", id);
    }

    // Termin buchen
    if (b.type === "Booking") {
      const path = str(p.bookingPath).trim();
      if (!path) err("buchung", "„Termin buchen“ ohne Buchungsseite. Adresse aus Kalender › Vorlagen eintragen.", id);
      else if (!BOOKING_PATH.test(path)) err("buchung", `„${path}“ ist keine gültige Buchungsseite (Format /buchen/<account>/<vorlage>).`, id);
      else if (ctx.bookingPaths && !ctx.bookingPaths.includes(path)) err("buchung", `Buchungsseite „${path}“ existiert nicht oder die Online-Buchung ist nicht freigeschaltet.`, id);
      if (str(p.mode) === "embed") {
        if (!str(p.heading).trim()) warn("buchung", "Eingebetteter Kalender ohne Überschrift – der Rahmen bekommt dann nur einen allgemeinen Titel.", id);
      } else {
        const label = str(p.buttonLabel).trim();
        if (label && GENERIC_LINK.test(label)) warn("link-text", `Beschriftung „${label}“ sagt nicht, wohin der Link führt.`, id);
      }
    }

    // FAQ / Features: leere Einträge
    if (b.type === "FAQ" && Array.isArray(p.items)) {
      for (const it of p.items as Record<string, unknown>[]) {
        if (!str(it.question).trim() || !str(it.answer).trim()) warn("faq", "FAQ-Eintrag ohne Frage oder Antwort.", id);
      }
    }
  }

  // Kontrast der Markenfarben
  const cPrimary = contrastRatio(ctx.brandPrimary, onColor(ctx.brandPrimary));
  if (cPrimary === null) err("kontrast", `Markenfarbe „${ctx.brandPrimary}“ ist keine gültige Farbe.`);
  else if (cPrimary < 4.5) err("kontrast", `Markenfarbe ${ctx.brandPrimary}: Textkontrast auf Buttons nur ${cPrimary.toFixed(2)}:1 (nötig 4,5:1). Farbe in den Einstellungen anpassen.`);
  const cPrimaryOnWhite = contrastRatio(ctx.brandPrimary, "#ffffff");
  if (cPrimaryOnWhite !== null && cPrimaryOnWhite < 3) warn("kontrast", `Markenfarbe auf Weiß nur ${cPrimaryOnWhite.toFixed(2)}:1 – Links und Akzente schlecht erkennbar (mind. 3:1).`);
  const cAccent = contrastRatio(ctx.brandAccent, onColor(ctx.brandAccent));
  if (cAccent !== null && cAccent < 4.5) warn("kontrast", `Akzentfarbe ${ctx.brandAccent}: Textkontrast nur ${cAccent.toFixed(2)}:1.`);

  const errors = issues.filter((i) => i.level === "error").length;
  return { ok: errors === 0, checkedAt: new Date().toISOString(), errors, warnings: issues.length - errors, issues };
}
