import sanitizeHtml from "sanitize-html";

// Strenge Allowlist für Logo-SVGs. Entfernt Skripte, Event-Handler, foreignObject,
// externe Referenzen und alles, was nicht ausdrücklich erlaubt ist.

const TAGS = [
  "svg", "g", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon", "text", "tspan",
  "defs", "lineargradient", "radialgradient", "stop", "clippath", "mask", "title", "desc", "use", "symbol",
];

const PRESENTATION = [
  "fill", "fill-opacity", "fill-rule", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin",
  "stroke-miterlimit", "stroke-dasharray", "stroke-dashoffset", "stroke-opacity", "opacity", "transform",
  "clip-path", "clip-rule", "mask", "font-family", "font-size", "font-weight", "font-style", "letter-spacing",
  "text-anchor", "dominant-baseline", "id", "class",
];

const GEOMETRY = [
  "x", "y", "x1", "y1", "x2", "y2", "cx", "cy", "r", "rx", "ry", "width", "height", "d", "points",
  "dx", "dy", "offset", "stop-color", "stop-opacity", "gradientunits", "gradienttransform", "fx", "fy",
  "clippathunits", "maskunits", "viewbox", "preserveaspectratio", "xmlns", "role", "aria-label", "aria-hidden",
];

export const MAX_SVG_BYTES = 100_000;

export function sanitizeSvg(input: string): string {
  if (input.length > MAX_SVG_BYTES) throw new Error("SVG ist zu groß (max. 100 KB)");
  const allowed = [...PRESENTATION, ...GEOMETRY, "href", "xlink:href"];
  const out = sanitizeHtml(input, {
    allowedTags: TAGS,
    allowedAttributes: Object.fromEntries(TAGS.map((t) => [t, allowed])),
    parser: { lowerCaseTags: true, lowerCaseAttributeNames: true, xmlMode: false },
    allowedSchemes: [],
    allowProtocolRelative: false,
    disallowedTagsMode: "discard",
    exclusiveFilter: () => false,
    transformTags: {
      "*": (tagName, attribs) => {
        const clean: Record<string, string> = {};
        for (const [k, v] of Object.entries(attribs)) {
          // href nur als interne Referenz (#id)
          if ((k === "href" || k === "xlink:href") && !/^#[\w-]+$/.test(v)) continue;
          // url(...) nur intern; keine javascript:/data:-Werte
          if (/url\(\s*['"]?(?!#)/i.test(v) || /javascript:|data:|expression\(/i.test(v)) continue;
          clean[k] = v;
        }
        return { tagName, attribs: clean };
      },
    },
  }).trim();
  if (!/^<svg[\s>]/i.test(out)) throw new Error("Datei enthält kein gültiges SVG");
  // sanitize-html schreibt viewBox klein; SVG ist hier case-sensitiv
  return out
    .replace(/\bviewbox=/g, "viewBox=")
    .replace(/\bpreserveaspectratio=/g, "preserveAspectRatio=")
    .replace(/\bgradientunits=/g, "gradientUnits=")
    .replace(/\bgradienttransform=/g, "gradientTransform=")
    .replace(/\bclippathunits=/g, "clipPathUnits=")
    .replace(/\bmaskunits=/g, "maskUnits=")
    .replace(/<lineargradient/g, "<linearGradient").replace(/<\/lineargradient>/g, "</linearGradient>")
    .replace(/<radialgradient/g, "<radialGradient").replace(/<\/radialgradient>/g, "</radialGradient>")
    .replace(/<clippath/g, "<clipPath").replace(/<\/clippath>/g, "</clipPath>");
}
