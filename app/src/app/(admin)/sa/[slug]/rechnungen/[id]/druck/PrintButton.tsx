"use client";

import { Printer } from "lucide-react";
import { btnCls } from "@/components/ui";

export function PrintButton() {
  return <button type="button" onClick={() => window.print()} className={btnCls}><Printer size={16} aria-hidden /> Drucken / als PDF speichern</button>;
}
