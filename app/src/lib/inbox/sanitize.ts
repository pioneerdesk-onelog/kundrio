import sanitizeHtml from "sanitize-html";

// Eingehende E-Mail-HTML bereinigen: keine Skripte, Formulare, iframes, Event-Handler, Styles mit URLs.
// Externe Bilder (häufig Tracking-Pixel) werden standardmäßig NICHT geladen – sie werden durch einen
// Platzhalter ersetzt; „Bilder laden“ rendert dieselbe Mail mit allowRemoteImages=true.
// Eingebettete Bilder (cid:) werden entfernt, da wir sie nicht ausliefern.

export type SanitizeOptions = { allowRemoteImages?: boolean };

export type SanitizeResult = { html: string; blockedImages: number; trackingPixels: number };

const ALLOWED_TAGS = [
  "a", "abbr", "b", "blockquote", "br", "caption", "center", "code", "col", "colgroup", "dd", "del", "div", "dl", "dt",
  "em", "font", "h1", "h2", "h3", "h4", "h5", "h6", "hr", "i", "img", "ins", "li", "ol", "p", "pre", "q", "s", "small",
  "span", "strike", "strong", "sub", "sup", "table", "tbody", "td", "tfoot", "th", "thead", "tr", "u", "ul",
];

function isTrackingPixel(attribs: Record<string, string>): boolean {
  const w = Number.parseInt(attribs.width ?? "", 10);
  const h = Number.parseInt(attribs.height ?? "", 10);
  if ((Number.isFinite(w) && w <= 2) || (Number.isFinite(h) && h <= 2)) return true;
  const style = (attribs.style ?? "").toLowerCase().replace(/\s/g, "");
  if (/(width|height):[0-2](px)?(;|$)/.test(style) || style.includes("display:none") || style.includes("visibility:hidden")) return true;
  return false;
}

/** Inline-Styles nur ohne URLs/Ausdrücke behalten (kein Nachladen über CSS). */
function safeStyle(style: string | undefined): string | undefined {
  if (!style) return undefined;
  if (/url\s*\(|expression\s*\(|@import|javascript:|behaviou?r\s*:/i.test(style)) return undefined;
  return style.length > 1000 ? undefined : style;
}

function withSafeStyle(attribs: Record<string, string>): Record<string, string> {
  const next = { ...attribs };
  const style = safeStyle(next.style);
  if (style) next.style = style;
  else delete next.style;
  return next;
}

export function sanitizeEmailHtml(html: string, opts: SanitizeOptions = {}): SanitizeResult {
  let blockedImages = 0;
  let trackingPixels = 0;
  const out = sanitizeHtml(html, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: {
      a: ["href", "title", "name", "target", "rel"],
      img: ["src", "alt", "width", "height", "title", "referrerpolicy", "loading"],
      span: ["data-pd-blocked", "title"],
      td: ["colspan", "rowspan", "align", "valign", "width", "style", "bgcolor"],
      th: ["colspan", "rowspan", "align", "valign", "width", "style", "bgcolor"],
      table: ["width", "cellpadding", "cellspacing", "border", "align", "style", "bgcolor"],
      font: ["color", "face", "size"],
      "*": ["style", "align", "dir", "lang"],
    },
    allowedSchemes: ["http", "https", "mailto", "tel"],
    allowedSchemesByTag: { img: ["http", "https"] },
    allowProtocolRelative: false,
    // Inhalte dieser Elemente vollständig verwerfen (nicht nur das Tag)
    nonTextTags: ["script", "style", "textarea", "option", "noscript", "title", "head", "form", "button", "select", "iframe", "object", "embed", "svg", "math"],
    transformTags: {
      a: (tagName, attribs) => ({ tagName, attribs: withSafeStyle({ ...attribs, target: "_blank", rel: "noopener noreferrer nofollow" }) }),
      img: (tagName, attribs) => {
        if (isTrackingPixel(attribs)) {
          trackingPixels++;
          return { tagName: "span", attribs: {} };
        }
        if (!opts.allowRemoteImages) {
          blockedImages++;
          return { tagName: "span", attribs: { "data-pd-blocked": "1", title: attribs.alt ? `Bild blockiert: ${attribs.alt}` : "Bild blockiert" } };
        }
        return { tagName, attribs: withSafeStyle({ ...attribs, referrerpolicy: "no-referrer", loading: "lazy" }) };
      },
      "*": (tagName, attribs) => ({ tagName, attribs: withSafeStyle(attribs) }),
    },
    exclusiveFilter: (frame) => frame.tag === "img" && !frame.attribs.src && !frame.attribs["data-pd-blocked"],
  });
  return { html: out, blockedImages, trackingPixels };
}
