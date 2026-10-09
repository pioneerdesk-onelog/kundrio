// Gemeinsame Puck-Konfiguration für Editor (Client) und öffentliche Darstellung (Server).
// Keine Hooks in den render-Funktionen: Animation und Formulare stecken in Client-Komponenten.
import type { ComponentConfig, Config, Fields } from "@puckeditor/core";
import type { CSSProperties, ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { PublicForm } from "@/components/b/PublicForm";
import { submitForm } from "@/app/(public)/f/[id]/actions";
import { safeHref } from "@/lib/p-tree";
import { Animate, AnimateItem, HoverLink, MotionRoot } from "./Animate";
import { fontStack, type Animation, type PageMeta } from "./types";

type Puck = { isEditing: boolean; metadata: Partial<PageMeta> };
type WithAnim = { animation: Animation };

const animationField = {
  type: "radio" as const,
  label: "Animation",
  options: [
    { label: "Keine", value: "none" },
    { label: "Dezent", value: "subtle" },
    { label: "Ausdrucksstark", value: "expressive" },
  ],
};

const container = "mx-auto w-full max-w-5xl px-6";
const btnPrimary =
  "inline-flex items-center justify-center rounded-lg bg-[var(--pd-primary)] px-6 py-3 text-[17px] font-semibold text-[color:var(--pd-on-primary)] shadow-sm transition hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--pd-primary)]";
const btnSecondary =
  "inline-flex items-center justify-center rounded-lg border-2 border-[var(--pd-primary)] px-6 py-3 text-[17px] font-semibold text-[color:var(--pd-primary)] transition hover:bg-[var(--pd-primary)] hover:text-[color:var(--pd-on-primary)]";
const headingCls = "font-[family-name:var(--pd-font-heading)] tracking-tight text-[color:var(--pd-ink)]";

function Md({ children }: { children: string }) {
  return (
    <div className="prose prose-lg max-w-none prose-headings:font-[family-name:var(--pd-font-heading)] prose-a:text-[color:var(--pd-primary)]">
      <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml>
        {children}
      </ReactMarkdown>
    </div>
  );
}

function Button({ label, href, animation, editing, variant = "primary" }: { label: string; href: unknown; animation: Animation; editing: boolean; variant?: "primary" | "secondary" }) {
  const target = safeHref(href);
  if (!label.trim() || !target) return null;
  return (
    <HoverLink animation={animation} editing={editing} href={target} className={variant === "primary" ? btnPrimary : btnSecondary}>
      {label}
    </HoverLink>
  );
}

// ---------- Block-Props ----------
type SectionProps = WithAnim & { background: "plain" | "sand" | "brand" | "dark"; spacing: "s" | "m" | "l"; content: unknown };
type ColumnsProps = WithAnim & { columns: "2" | "3"; left: unknown; middle: unknown; right: unknown };
type HeroProps = WithAnim & { eyebrow: string; heading: string; text: string; buttonLabel: string; buttonHref: string; secondaryLabel: string; secondaryHref: string; align: "left" | "center"; showLogo: "yes" | "no" };
type HeadingProps = WithAnim & { text: string; level: "2" | "3" };
type TextProps = WithAnim & { markdown: string };
type FeaturesProps = WithAnim & { heading: string; items: { title: string; text: string }[] };
type FaqProps = WithAnim & { heading: string; items: { question: string; answer: string }[] };
type CtaProps = WithAnim & { heading: string; text: string; buttonLabel: string; buttonHref: string };
type ImageProps = WithAnim & { src: string; alt: string; decorative: "no" | "yes"; caption: string };
type FormProps = WithAnim & { heading: string; formId: string };
type LinkButtonProps = WithAnim & { label: string; href: string; variant: "primary" | "secondary"; align: "left" | "center" };
type BookingProps = WithAnim & { heading: string; text: string; bookingPath: string; mode: "button" | "embed"; buttonLabel: string };
type SpacerProps = { size: "s" | "m" | "l" };
type FooterProps = { note: string };

export type BlockProps = {
  Section: SectionProps;
  Columns: ColumnsProps;
  Hero: HeroProps;
  Heading: HeadingProps;
  Text: TextProps;
  Features: FeaturesProps;
  FAQ: FaqProps;
  CTA: CtaProps;
  Image: ImageProps;
  Form: FormProps;
  LinkButton: LinkButtonProps;
  Booking: BookingProps;
  Spacer: SpacerProps;
  Footer: FooterProps;
};

export const BLOCK_TYPES = [
  "Section", "Columns", "Hero", "Heading", "Text", "Features", "FAQ", "CTA", "Image", "Form", "LinkButton", "Booking", "Spacer", "Footer",
] as const;

/** Nur eigene Buchungsseiten (/buchen/<sub-account>/<adresse>) sind als Ziel des Buchungs-Blocks erlaubt. */
const BOOKING_PATH = /^\/buchen\/[a-z0-9-]{1,80}\/[a-z0-9-]{1,60}$/;

type Slot = (props?: { className?: string; style?: CSSProperties }) => ReactNode;

const SECTION_BG: Record<SectionProps["background"], string> = {
  plain: "",
  sand: "bg-[#f4f2ec]",
  brand: "bg-[var(--pd-primary)] text-[color:var(--pd-on-primary)] [--pd-ink:var(--pd-on-primary)]",
  dark: "bg-[#0e141b] text-white [--pd-ink:#ffffff]",
};
const SPACING = { s: "py-8", m: "py-14 md:py-20", l: "py-20 md:py-28" } as const;

/** Erzeugt die Konfiguration; `forms` füllt die Formularauswahl im Editor. */
export function createConfig(forms: { id: string; name: string }[] = []): Config<BlockProps> {
  const formOptions = [{ label: "– Formular wählen –", value: "" }, ...forms.map((f) => ({ label: f.name, value: f.id }))];

  const Section: ComponentConfig<SectionProps> = {
    label: "Abschnitt",
    fields: {
      background: { type: "select", label: "Hintergrund", options: [
        { label: "Ohne", value: "plain" }, { label: "Sand", value: "sand" }, { label: "Markenfarbe", value: "brand" }, { label: "Dunkel", value: "dark" },
      ] },
      spacing: { type: "radio", label: "Abstand", options: [{ label: "Klein", value: "s" }, { label: "Mittel", value: "m" }, { label: "Groß", value: "l" }] },
      animation: animationField,
      content: { type: "slot", label: "Inhalt", disallow: ["Section", "Footer"] },
    } as Fields<SectionProps>,
    defaultProps: { background: "plain", spacing: "m", animation: "subtle", content: [] },
    render: ({ background, spacing, animation, content, puck }) => {
      const Content = content as unknown as Slot;
      return (
        <section className={`${SECTION_BG[background]} ${SPACING[spacing]}`}>
          <Animate animation={animation} editing={(puck as Puck).isEditing} className={`${container} space-y-8`}>
            <Content className="space-y-8" />
          </Animate>
        </section>
      );
    },
  };

  const Columns: ComponentConfig<ColumnsProps> = {
    label: "Spalten",
    fields: {
      columns: { type: "radio", label: "Spalten", options: [{ label: "2", value: "2" }, { label: "3", value: "3" }] },
      animation: animationField,
      left: { type: "slot", label: "Spalte 1", disallow: ["Section", "Columns", "Hero", "Footer"] },
      middle: { type: "slot", label: "Spalte 2", disallow: ["Section", "Columns", "Hero", "Footer"] },
      right: { type: "slot", label: "Spalte 3 (nur bei 3 Spalten)", disallow: ["Section", "Columns", "Hero", "Footer"] },
    } as Fields<ColumnsProps>,
    defaultProps: { columns: "2", animation: "none", left: [], middle: [], right: [] },
    render: ({ columns, animation, left, middle, right, puck }) => {
      const [L, M, R] = [left, middle, right] as unknown as Slot[];
      const editing = (puck as Puck).isEditing;
      return (
        <Animate animation={animation} editing={editing} className={`grid gap-8 ${columns === "3" ? "md:grid-cols-3" : "md:grid-cols-2"}`}>
          <AnimateItem animation={animation} editing={editing}><L className="space-y-6" /></AnimateItem>
          <AnimateItem animation={animation} editing={editing}><M className="space-y-6" /></AnimateItem>
          {columns === "3" && <AnimateItem animation={animation} editing={editing}><R className="space-y-6" /></AnimateItem>}
        </Animate>
      );
    },
  };

  const Hero: ComponentConfig<HeroProps> = {
    label: "Hero (Hauptüberschrift)",
    fields: {
      eyebrow: { type: "text", label: "Dachzeile" },
      heading: { type: "textarea", label: "Hauptüberschrift (H1)" },
      text: { type: "textarea", label: "Einleitung" },
      buttonLabel: { type: "text", label: "Button-Text" },
      buttonHref: { type: "text", label: "Button-Ziel (URL, #anker, /pfad)" },
      secondaryLabel: { type: "text", label: "Zweiter Button – Text" },
      secondaryHref: { type: "text", label: "Zweiter Button – Ziel" },
      align: { type: "radio", label: "Ausrichtung", options: [{ label: "Links", value: "left" }, { label: "Mitte", value: "center" }] },
      showLogo: { type: "radio", label: "Logo zeigen", options: [{ label: "Ja", value: "yes" }, { label: "Nein", value: "no" }] },
      animation: animationField,
    },
    defaultProps: {
      eyebrow: "", heading: "Ihre Hauptaussage in einem Satz", text: "Ein bis zwei Sätze, die den Nutzen erklären.",
      buttonLabel: "Jetzt Kontakt aufnehmen", buttonHref: "#kontakt", secondaryLabel: "", secondaryHref: "", align: "left", showLogo: "yes", animation: "subtle",
    },
    render: ({ eyebrow, heading, text, buttonLabel, buttonHref, secondaryLabel, secondaryHref, align, showLogo, animation, puck }) => {
      const { isEditing, metadata } = puck as Puck;
      const center = align === "center";
      return (
        <header className="py-16 md:py-24">
          <Animate animation={animation} editing={isEditing} className={`${container} ${center ? "text-center" : ""}`}>
            {showLogo === "yes" && metadata.brand?.logoDataUrl && (
              <AnimateItem animation={animation} editing={isEditing} className={`mb-8 ${center ? "flex justify-center" : ""}`}>
                {/* eslint-disable-next-line @next/next/no-img-element -- SVG-Logo als Data-URL */}
                <img src={metadata.brand.logoDataUrl} alt={metadata.brand.name} className="h-10 w-auto" />
              </AnimateItem>
            )}
            {eyebrow && (
              <AnimateItem animation={animation} editing={isEditing} className="mb-3 font-mono text-sm uppercase tracking-widest text-[color:var(--pd-primary)]">
                {eyebrow}
              </AnimateItem>
            )}
            <AnimateItem animation={animation} editing={isEditing}>
              <h1 className={`${headingCls} text-4xl leading-[1.1] md:text-6xl ${center ? "mx-auto" : ""} max-w-4xl`}>{heading}</h1>
            </AnimateItem>
            {text && (
              <AnimateItem animation={animation} editing={isEditing}>
                <p className={`mt-6 max-w-2xl text-xl leading-relaxed opacity-90 ${center ? "mx-auto" : ""}`}>{text}</p>
              </AnimateItem>
            )}
            <AnimateItem animation={animation} editing={isEditing} className={`mt-9 flex flex-wrap gap-3 ${center ? "justify-center" : ""}`}>
              <Button label={buttonLabel} href={buttonHref} animation={animation} editing={isEditing} />
              <Button label={secondaryLabel} href={secondaryHref} animation={animation} editing={isEditing} variant="secondary" />
            </AnimateItem>
          </Animate>
        </header>
      );
    },
  };

  const Heading: ComponentConfig<HeadingProps> = {
    label: "Überschrift",
    fields: {
      text: { type: "text", label: "Text" },
      level: { type: "radio", label: "Ebene", options: [{ label: "H2", value: "2" }, { label: "H3", value: "3" }] },
      animation: animationField,
    },
    defaultProps: { text: "Zwischenüberschrift", level: "2", animation: "none" },
    render: ({ text, level, animation, puck }) => (
      <Animate animation={animation} editing={(puck as Puck).isEditing}>
        {level === "3" ? <h3 className={`${headingCls} text-2xl`}>{text}</h3> : <h2 className={`${headingCls} text-3xl md:text-4xl`}>{text}</h2>}
      </Animate>
    ),
  };

  const Text: ComponentConfig<TextProps> = {
    label: "Text (Markdown)",
    fields: { markdown: { type: "textarea", label: "Text (Markdown: **fett**, - Liste, [Link](https://…))" }, animation: animationField },
    defaultProps: { markdown: "Schreiben Sie hier Ihren Text.", animation: "none" },
    render: ({ markdown, animation, puck }) => (
      <Animate animation={animation} editing={(puck as Puck).isEditing} className="max-w-3xl">
        <Md>{markdown}</Md>
      </Animate>
    ),
  };

  const Features: ComponentConfig<FeaturesProps> = {
    label: "Leistungen / Vorteile",
    fields: {
      heading: { type: "text", label: "Überschrift (H2)" },
      items: { type: "array", label: "Einträge", arrayFields: { title: { type: "text", label: "Titel" }, text: { type: "textarea", label: "Text" } }, getItemSummary: (i) => i.title || "Eintrag", defaultItemProps: { title: "Vorteil", text: "Kurze Erklärung." } },
      animation: animationField,
    },
    defaultProps: { heading: "Was Sie bekommen", items: [{ title: "Vorteil 1", text: "Kurze Erklärung." }, { title: "Vorteil 2", text: "Kurze Erklärung." }, { title: "Vorteil 3", text: "Kurze Erklärung." }], animation: "subtle" },
    render: ({ heading, items, animation, puck }) => {
      const editing = (puck as Puck).isEditing;
      return (
        <section>
          {heading && <h2 className={`${headingCls} mb-8 text-3xl md:text-4xl`}>{heading}</h2>}
          <Animate as="ul" animation={animation} editing={editing} className="grid gap-6 md:grid-cols-3">
            {(items ?? []).map((it, i) => (
              <AnimateItem as="li" key={i} animation={animation} editing={editing} className="rounded-2xl border border-black/10 bg-white/70 p-6 text-[#1f2a37]">
                <div className="mb-3 h-1 w-10 rounded-full bg-[var(--pd-primary)]" aria-hidden />
                <h3 className="mb-2 text-xl font-semibold text-[#0e141b]">{it.title}</h3>
                <p className="leading-relaxed">{it.text}</p>
              </AnimateItem>
            ))}
          </Animate>
        </section>
      );
    },
  };

  const FAQ: ComponentConfig<FaqProps> = {
    label: "Häufige Fragen (FAQ)",
    fields: {
      heading: { type: "text", label: "Überschrift (H2)" },
      items: { type: "array", label: "Fragen", arrayFields: { question: { type: "text", label: "Frage" }, answer: { type: "textarea", label: "Antwort" } }, getItemSummary: (i) => i.question || "Frage", defaultItemProps: { question: "Frage?", answer: "Antwort." } },
      animation: animationField,
    },
    defaultProps: { heading: "Häufige Fragen", items: [{ question: "Was kostet das?", answer: "Antwort hier eintragen." }], animation: "none" },
    render: ({ heading, items, animation, puck }) => {
      const editing = (puck as Puck).isEditing;
      return (
        <section className="max-w-3xl">
          {heading && <h2 className={`${headingCls} mb-6 text-3xl md:text-4xl`}>{heading}</h2>}
          <Animate animation={animation} editing={editing} className="divide-y divide-black/10 border-y border-black/10">
            {(items ?? []).map((it, i) => (
              <AnimateItem key={i} animation={animation} editing={editing}>
                <details className="group py-4" open={editing}>
                  <summary className="cursor-pointer list-none text-lg font-semibold marker:hidden">
                    <span className="mr-2 inline-block text-[color:var(--pd-primary)] transition group-open:rotate-90" aria-hidden>›</span>
                    {it.question}
                  </summary>
                  <div className="mt-3 pl-5"><Md>{it.answer}</Md></div>
                </details>
              </AnimateItem>
            ))}
          </Animate>
        </section>
      );
    },
  };

  const CTA: ComponentConfig<CtaProps> = {
    label: "Handlungsaufforderung (CTA)",
    fields: {
      heading: { type: "text", label: "Überschrift (H2)" },
      text: { type: "textarea", label: "Text" },
      buttonLabel: { type: "text", label: "Button-Text" },
      buttonHref: { type: "text", label: "Button-Ziel" },
      animation: animationField,
    },
    defaultProps: { heading: "Bereit für den nächsten Schritt?", text: "", buttonLabel: "Termin vereinbaren", buttonHref: "#kontakt", animation: "subtle" },
    render: ({ heading, text, buttonLabel, buttonHref, animation, puck }) => {
      const editing = (puck as Puck).isEditing;
      return (
        <Animate animation={animation} editing={editing} className="rounded-3xl bg-[var(--pd-primary)] px-8 py-12 text-center text-[color:var(--pd-on-primary)] md:px-16">
          <AnimateItem animation={animation} editing={editing}>
            <h2 className="font-[family-name:var(--pd-font-heading)] text-3xl tracking-tight md:text-4xl">{heading}</h2>
          </AnimateItem>
          {text && <AnimateItem animation={animation} editing={editing}><p className="mx-auto mt-4 max-w-2xl text-lg opacity-90">{text}</p></AnimateItem>}
          <AnimateItem animation={animation} editing={editing} className="mt-8">
            {safeHref(buttonHref) && buttonLabel.trim() && (
              <HoverLink animation={animation} editing={editing} href={safeHref(buttonHref)!} className="inline-flex items-center justify-center rounded-lg bg-[var(--pd-on-primary)] px-6 py-3 text-[17px] font-semibold text-[color:var(--pd-primary)]">
                {buttonLabel}
              </HoverLink>
            )}
          </AnimateItem>
        </Animate>
      );
    },
  };

  const Image: ComponentConfig<ImageProps> = {
    label: "Bild",
    fields: {
      src: { type: "text", label: "Bild-Adresse (https://… oder /pfad)" },
      alt: { type: "textarea", label: "Alternativtext (Pflicht: was zeigt das Bild?)" },
      decorative: { type: "radio", label: "Nur dekorativ (kein Inhalt)?", options: [{ label: "Nein", value: "no" }, { label: "Ja", value: "yes" }] },
      caption: { type: "text", label: "Bildunterschrift" },
      animation: animationField,
    },
    defaultProps: { src: "", alt: "", decorative: "no", caption: "", animation: "subtle" },
    render: ({ src, alt, decorative, caption, animation, puck }) => {
      const ok = /^(https:\/\/|\/)/i.test(src ?? "");
      return (
        <Animate animation={animation} editing={(puck as Puck).isEditing}>
          <figure>
            {ok ? (
              // eslint-disable-next-line @next/next/no-img-element -- beliebige Quellen, keine Next-Optimierung nötig
              <img src={src} alt={decorative === "yes" ? "" : alt} loading="lazy" className="w-full rounded-2xl" />
            ) : (
              <div className="flex h-48 items-center justify-center rounded-2xl border-2 border-dashed border-black/20 text-sm opacity-70">Bild-Adresse eintragen</div>
            )}
            {caption && <figcaption className="mt-2 text-sm opacity-75">{caption}</figcaption>}
          </figure>
        </Animate>
      );
    },
  };

  const Form: ComponentConfig<FormProps> = {
    label: "Formular (aus dem CRM)",
    fields: {
      heading: { type: "text", label: "Überschrift (H2)" },
      formId: { type: "select", label: "Formular", options: formOptions },
      animation: animationField,
    },
    defaultProps: { heading: "Kontakt aufnehmen", formId: "", animation: "none" },
    render: ({ heading, formId, animation, puck }) => {
      const { isEditing, metadata } = puck as Puck;
      const form = formId ? metadata.forms?.[formId] : undefined;
      return (
        <section id="kontakt" className="scroll-mt-8">
          <Animate animation={animation} editing={isEditing} className="mx-auto max-w-xl rounded-2xl border border-black/10 bg-white p-6 text-[#1f2a37] shadow-sm md:p-8">
            {heading && <h2 className="mb-5 font-[family-name:var(--pd-font-heading)] text-3xl tracking-tight text-[#0e141b]">{heading}</h2>}
            {!form ? (
              <p className="text-sm opacity-70">{isEditing ? "Bitte rechts ein Formular auswählen." : "Formular nicht verfügbar."}</p>
            ) : isEditing ? (
              <div className="space-y-3" aria-hidden>
                {form.fields.map((f) => (
                  <div key={f.key}>
                    <div className="text-sm">{f.label}{f.required && " *"}</div>
                    <div className="mt-1 h-10 rounded-md border border-black/15 bg-black/[0.02]" />
                  </div>
                ))}
                <div className={`${btnPrimary} pointer-events-none`}>Absenden</div>
              </div>
            ) : (
              <PublicForm action={submitForm.bind(null, formId)} fields={form.fields} consentText={form.consentText} ts={form.ts} />
            )}
          </Animate>
        </section>
      );
    },
  };

  const LinkButton: ComponentConfig<LinkButtonProps> = {
    label: "Button / Termin-Link",
    fields: {
      label: { type: "text", label: "Beschriftung (sagt, was passiert)" },
      href: { type: "text", label: "Ziel (URL, mailto:, tel:, #anker)" },
      variant: { type: "radio", label: "Stil", options: [{ label: "Primär", value: "primary" }, { label: "Umriss", value: "secondary" }] },
      align: { type: "radio", label: "Ausrichtung", options: [{ label: "Links", value: "left" }, { label: "Mitte", value: "center" }] },
      animation: animationField,
    },
    defaultProps: { label: "Termin buchen", href: "", variant: "primary", align: "left", animation: "none" },
    render: ({ label, href, variant, align, animation, puck }) => (
      <div className={align === "center" ? "text-center" : ""}>
        <Button label={label} href={href} animation={animation} editing={(puck as Puck).isEditing} variant={variant} />
      </div>
    ),
  };

  const Booking: ComponentConfig<BookingProps> = {
    label: "Termin buchen",
    fields: {
      heading: { type: "text", label: "Überschrift (H2)" },
      text: { type: "textarea", label: "Text (optional)" },
      bookingPath: { type: "text", label: "Buchungsseite (z. B. /buchen/mein-account/erstgespraech – steht in Kalender › Vorlagen)" },
      mode: { type: "radio", label: "Darstellung", options: [{ label: "Button", value: "button" }, { label: "Kalender einbetten", value: "embed" }] },
      buttonLabel: { type: "text", label: "Button-Text" },
      animation: animationField,
    },
    defaultProps: { heading: "Termin buchen", text: "", bookingPath: "", mode: "button", buttonLabel: "Freie Termine ansehen", animation: "subtle" },
    render: ({ heading, text, bookingPath, mode, buttonLabel, animation, puck }) => {
      const editing = (puck as Puck).isEditing;
      const path = BOOKING_PATH.test(bookingPath.trim()) ? bookingPath.trim() : null;
      return (
        <Animate animation={animation} editing={editing} as="section" className="mx-auto max-w-3xl">
          {heading && <h2 className="font-[family-name:var(--pd-font-heading)] text-3xl tracking-tight text-[color:var(--pd-ink)]">{heading}</h2>}
          {text && <p className="mt-3 text-lg opacity-90">{text}</p>}
          <div className="mt-6">
            {!path ? (
              editing ? <p className="rounded-lg border border-dashed p-4 text-sm">Bitte die Adresse einer Buchungsseite eintragen.</p> : null
            ) : mode === "embed" && !editing ? (
              <iframe src={`${path}?einbettung=1`} title={heading ? `${heading} – Terminbuchung` : "Terminbuchung"} loading="lazy" className="h-[760px] w-full rounded-xl border-0 bg-white" />
            ) : (
              <Button label={buttonLabel.trim() || "Termin buchen"} href={path} animation={animation} editing={editing} />
            )}
          </div>
        </Animate>
      );
    },
  };

  const Spacer: ComponentConfig<SpacerProps> = {
    label: "Abstand",
    fields: { size: { type: "radio", label: "Größe", options: [{ label: "Klein", value: "s" }, { label: "Mittel", value: "m" }, { label: "Groß", value: "l" }] } },
    defaultProps: { size: "m" },
    render: ({ size }) => <div aria-hidden className={size === "s" ? "h-6" : size === "l" ? "h-24" : "h-12"} />,
  };

  const Footer: ComponentConfig<FooterProps> = {
    label: "Fuß (Impressum)",
    fields: { note: { type: "textarea", label: "Zusätzlicher Hinweis (optional)" } },
    defaultProps: { note: "" },
    render: ({ note, puck }) => <SiteFooter meta={(puck as Puck).metadata} note={note} />,
  };

  return {
    categories: {
      layout: { title: "Aufbau", components: ["Section", "Columns", "Spacer"] },
      inhalt: { title: "Inhalt", components: ["Hero", "Heading", "Text", "Features", "FAQ", "Image"] },
      aktion: { title: "Aktion", components: ["CTA", "Form", "LinkButton", "Booking"] },
      rahmen: { title: "Rahmen", components: ["Footer"] },
    },
    root: {
      render: ({ children, puck }) => <Theme meta={(puck as unknown as Puck).metadata}>{children}</Theme>,
    },
    components: { Section, Columns, Hero, Heading, Text, Features, FAQ, CTA, Image, Form, LinkButton, Booking, Spacer, Footer },
  } as Config<BlockProps>;
}

/** CSS-Variablen aus dem Branding des Sub-Accounts; Grundschrift 18px für gute Lesbarkeit. */
export function Theme({ meta, children }: { meta: Partial<PageMeta>; children: ReactNode }) {
  const b = meta.brand;
  const style = {
    "--pd-primary": b?.primary ?? "#0B4F6C",
    "--pd-accent": b?.accent ?? "#C0D3DA",
    "--pd-on-primary": b?.onPrimary ?? "#ffffff",
    "--pd-on-accent": b?.onAccent ?? "#0e141b",
    "--pd-ink": "#0e141b",
    "--pd-font-heading": fontStack(b?.fontHeading ?? "Newsreader"),
    "--pd-font-body": fontStack(b?.fontBody ?? "Inter"),
    fontFamily: "var(--pd-font-body)",
  } as CSSProperties;
  return (
    <MotionRoot>
      <div lang={meta.lang} style={style} className="min-h-full bg-[#fbfaf7] text-[18px] leading-relaxed text-[#1f2a37]">
        {children}
      </div>
    </MotionRoot>
  );
}

/** Seitenfuß mit Impressum und KI-Hinweis (AI Act). Wird automatisch ergänzt, falls kein Fuß-Block existiert. */
export function SiteFooter({ meta, note }: { meta: Partial<PageMeta>; note?: string }) {
  return (
    <footer className="mt-16 border-t border-black/10 bg-[#f4f2ec] py-10 text-base text-[#3f4853]">
      <div className={`${container} space-y-4`}>
        {note && <p>{note}</p>}
        {meta.imprint ? (
          <div className="prose max-w-none text-[#3f4853]">
            <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml>{meta.imprint}</ReactMarkdown>
          </div>
        ) : (
          <p>{meta.legalName ?? meta.brand?.name}</p>
        )}
        {meta.aiGenerated && (
          <p className="text-sm">
            <span aria-hidden>✦ </span>Diese Seite wurde mit KI-Unterstützung erstellt und von Menschen geprüft.
          </p>
        )}
      </div>
    </footer>
  );
}
