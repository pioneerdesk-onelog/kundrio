import type { Metadata } from "next";
import "@fontsource-variable/inter";
import "@fontsource-variable/newsreader";
import "@fontsource-variable/jetbrains-mono";
import "./globals.css";
import { GermanValidation } from "@/components/GermanValidation";

export const metadata: Metadata = {
  title: "Kundrio",
  description: "Agentur-CRM für alle Pioneerdesk-Projekte",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="de">
      <body className="antialiased">
        <GermanValidation />
        {children}
      </body>
    </html>
  );
}
