"use client";

import { useEffect } from "react";

type Field = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

// Browser zeigen Pflichtfeld-/Formathinweise in der Sprache des Browsers (oft Englisch).
// Wir ersetzen sie zentral durch deutsche Texte – für alle Formulare, intern und öffentlich.
export function germanMessage(el: Field): string {
  const v = el.validity;
  if (v.valueMissing) {
    if (el instanceof HTMLSelectElement) return "Bitte wählen Sie einen Eintrag aus.";
    if (el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio")) return "Bitte setzen Sie hier ein Häkchen bzw. wählen Sie eine Option.";
    if (el instanceof HTMLInputElement && el.type === "file") return "Bitte wählen Sie eine Datei aus.";
    return "Bitte füllen Sie dieses Feld aus.";
  }
  if (v.typeMismatch) {
    if (el.type === "email") return "Bitte geben Sie eine gültige E-Mail-Adresse ein (z. B. name@firma.de).";
    if (el.type === "url") return "Bitte geben Sie eine gültige Adresse ein (z. B. https://firma.de).";
    return "Bitte prüfen Sie das Format.";
  }
  if (v.tooShort && "minLength" in el) return `Bitte mindestens ${el.minLength} Zeichen eingeben (aktuell ${el.value.length}).`;
  if (v.tooLong && "maxLength" in el) return `Bitte höchstens ${el.maxLength} Zeichen eingeben.`;
  if (v.rangeUnderflow && el instanceof HTMLInputElement) return `Der Wert muss mindestens ${el.min} sein.`;
  if (v.rangeOverflow && el instanceof HTMLInputElement) return `Der Wert darf höchstens ${el.max} sein.`;
  if (v.stepMismatch) return "Bitte geben Sie einen gültigen Wert ein.";
  if (v.badInput) return "Bitte geben Sie eine Zahl ein.";
  if (v.patternMismatch) return el.title ? `Bitte im geforderten Format eingeben: ${el.title}` : "Bitte im geforderten Format eingeben.";
  return "Bitte prüfen Sie diese Eingabe.";
}

export function GermanValidation() {
  useEffect(() => {
    const onInvalid = (e: Event) => {
      const el = e.target as Field;
      if (!("validity" in el) || el.validity.customError) return; // eigene Meldungen der App nicht überschreiben
      el.setCustomValidity(germanMessage(el));
    };
    // Nach jeder Eingabe zurücksetzen, sonst bliebe das Feld dauerhaft ungültig
    const reset = (e: Event) => {
      const el = e.target as Field;
      if ("setCustomValidity" in el && el.dataset.customValidity !== "app") el.setCustomValidity("");
    };
    document.addEventListener("invalid", onInvalid, true);
    document.addEventListener("input", reset, true);
    document.addEventListener("change", reset, true);
    return () => {
      document.removeEventListener("invalid", onInvalid, true);
      document.removeEventListener("input", reset, true);
      document.removeEventListener("change", reset, true);
    };
  }, []);
  return null;
}
