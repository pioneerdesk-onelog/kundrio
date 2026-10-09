// Prüfung hochgeladener Dateien: Größe, erlaubte Typen, Inhalt passt zur Endung (Magic Bytes).
// Rein und ohne Abhängigkeiten – auch in Tests nutzbar.

export const MAX_FILE_BYTES = 25 * 1024 * 1024;

export type FileType = "pdf" | "docx" | "pptx" | "png" | "jpg" | "svg" | "txt" | "md";

export const ALLOWED: Record<FileType, { mime: string; ext: string[] }> = {
  pdf: { mime: "application/pdf", ext: ["pdf"] },
  docx: { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", ext: ["docx"] },
  pptx: { mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation", ext: ["pptx"] },
  png: { mime: "image/png", ext: ["png"] },
  jpg: { mime: "image/jpeg", ext: ["jpg", "jpeg"] },
  svg: { mime: "image/svg+xml", ext: ["svg"] },
  txt: { mime: "text/plain", ext: ["txt"] },
  md: { mime: "text/markdown", ext: ["md", "markdown"] },
};

export const ACCEPT_ATTR = Object.values(ALLOWED)
  .flatMap((a) => a.ext.map((e) => `.${e}`))
  .join(",");

function startsWith(buf: Uint8Array, sig: number[]) {
  return sig.every((b, i) => buf[i] === b);
}

/** Erkennt den Typ aus Endung UND Inhalt. Wirft mit verständlicher Meldung, wenn etwas nicht passt. */
export function detectFileType(name: string, data: Uint8Array): FileType {
  if (data.length === 0) throw new Error(`„${name}“ ist leer.`);
  if (data.length > MAX_FILE_BYTES) throw new Error(`„${name}“ ist größer als 25 MB.`);
  const ext = (name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "") as string;
  const type = (Object.keys(ALLOWED) as FileType[]).find((t) => ALLOWED[t].ext.includes(ext));
  if (!type) throw new Error(`Dateityp „.${ext || "?"}“ ist nicht erlaubt (PDF, DOCX, PPTX, PNG, JPG, SVG, TXT, MD).`);

  const head = data.subarray(0, 512);
  const text = new TextDecoder("utf-8", { fatal: false }).decode(head);
  const ok = (() => {
    switch (type) {
      case "pdf":
        return startsWith(head, [0x25, 0x50, 0x44, 0x46]); // %PDF
      case "docx":
      case "pptx":
        return startsWith(head, [0x50, 0x4b, 0x03, 0x04]); // ZIP (Office Open XML)
      case "png":
        return startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      case "jpg":
        return startsWith(head, [0xff, 0xd8, 0xff]);
      case "svg":
        return /<svg[\s>]/i.test(new TextDecoder().decode(data.subarray(0, 4096)));
      case "txt":
      case "md":
        // Kein Binärinhalt (Nullbytes) in Textdateien
        return !head.includes(0) && text.length > 0;
    }
  })();
  if (!ok) throw new Error(`Inhalt von „${name}“ passt nicht zur Endung .${ext}.`);
  return type;
}

/** Dateiname ohne Pfadbestandteile und Steuerzeichen, gekürzt. */
export function safeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "datei";
  const clean = base.normalize("NFC").replace(/[\u0000-\u001f\u007f"<>|:*?]/g, "_").trim();
  return (clean || "datei").slice(0, 120);
}
