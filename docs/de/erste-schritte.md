# Erste Schritte

[English](../en/getting-started.md)

## Begriffe

- **Agentur**: die oberste Ebene, also du bzw. dein Unternehmen. Die Agentur-Übersicht (`/`) zeigt Kennzahlen aller Sub-Accounts.
- **Sub-Account**: ein Kunde oder ein eigenes Projekt. Alle fachlichen Daten (Kontakte, Deals, Mails, Seiten, Rechnungen …) gehören zu genau einem Sub-Account und sind von den anderen getrennt. Adresse: `/sa/<kürzel>`.
- **Mitglied**: eine Person mit Zugang zu einem Sub-Account und einer Rolle dort.

## 1. Ersten Benutzer anlegen

Eine Selbstregistrierung gibt es bewusst nicht. Der erste Benutzer entsteht auf der Kommandozeile:

```bash
cd app
npm run user:create -- du@example.com "Dein Name" --agency
```

Die Ausgabe enthält ein **Einmal-Passwort**. Melde dich unter `/login` an und ändere es sofort unter *Konto*. Der erste Agentur-Benutzer wird **Inhaber**, jeder weitere mit `--agency` wird Agentur-Admin. Eine Zwei-Faktor-Anmeldung gibt es noch nicht; nutze ein langes, nur hier verwendetes Passwort.

Mit `--workspace <kürzel>:ADMIN` (oder `:MEMBER`) bekommt ein Benutzer direkt Zugang zu einem Sub-Account.

## 2. Agentur und Sub-Accounts

`npm run db:seed` legt die Agentur und die Sub-Accounts aus `app/prisma/seed.ts` an, in der öffentlichen Ausgabe eine **Demo-Agentur** mit vier Demo-Sub-Accounts. Jeder Sub-Account bekommt:

- eine Vertriebs-Pipeline (Neu, Kontaktiert, Qualifiziert, Angebot, Gewonnen, Verloren)
- eine Ticket-Pipeline „Support“
- Lifecycle-Phasen nach HubSpot-Vorbild
- eine Wissensseite „start“

**Eigene Sub-Accounts:** Trage sie in `WORKSPACES` in `app/prisma/seed.ts` ein (Kürzel, Name, Domain, Markenfarben) und führe `npm run db:seed` erneut aus. Das ist gefahrlos: Bestehende Sub-Accounts werden nicht verändert. Name, Absender, Farben, Schriften, Region, Sprachen und Impressum änderst du danach in der App unter *Einstellungen*; das Kürzel bleibt fest. Ein Dialog zum Anlegen von Sub-Accounts in der Oberfläche ist geplant.

## 3. Sub-Account einrichten

Unter *Einstellungen* des Sub-Accounts:

1. **Name, Domain, Beschreibung** und **Absender** (Name und Adresse für E-Mails).
2. **Rechtliches**: Firmenname, Anschrift, USt-IdNr., Telefon, E-Mail, Impressum. Diese Angaben erscheinen auf Rechnungen und Landingpages.
3. **Bankverbindung** (IBAN/BIC) für Rechnungen und GiroCode, bei Lastschriften zusätzlich die **Gläubiger-ID**.
4. **Marke**: Farben, Schriften, Logo (SVG). Optional ein Brandbook hochladen oder die CI von der Website übernehmen; die Markenstimme fließt in KI-Texte ein.
5. **Region** (DE oder EU). Das Souveränitäts-Cockpit warnt, wenn eine aktive Verbindung diese Region verlässt.
6. **Erlaubte Domains** für das Analytics-Snippet und die Agent-API.
7. **Freigaben**: Vier-Augen-Prinzip ein- oder ausschalten (Standard aus).

Danach im Pflichten-Cockpit (*Pflichten*) nachsehen, was noch fehlt.

## 4. Team und Rollen

**Agentur-Ebene** (`/benutzer`): Inhaber, Admin (Zugang zu allen Sub-Accounts) und Mitarbeiter (nur zugewiesene Sub-Accounts). Unter *Person einladen* verschickst du eine Einladung; die Person setzt ihr Passwort über den Link selbst.

**Sub-Account-Ebene** (*Team*): Hier lädst du Personen in einen Sub-Account ein und vergibst eine Rolle. Mitgelieferte Rollenvorlagen:

| Rolle | Gedacht für |
|---|---|
| Admin | alles im Sub-Account, inklusive Einstellungen und Benutzer |
| Teamleitung | Vertrieb und Service des eigenen Teams, Freigaben |
| Vertrieb | eigene Kontakte, Unternehmen, Deals, Aufgaben |
| Service | Tickets, Posteingang, Kontakte |
| Marketing | E-Mail, Kampagnen, Formulare, Landingpages, Analytics |
| Buchhaltung | Angebote, Rechnungen, Abos, Zahlungen |
| Nur lesen | ansehen ohne Ändern |

Rollen sind Vorlagen und lassen sich unter *Team → Rollen* anpassen. Für jedes Objekt (Kontakte, Unternehmen, Deals, Tickets, Aufgaben, Rechnungen, E-Mail, Listen, Formulare, Seiten, Wissen, Prozesse, Analytics, Pflichten) gibt es **lesen, bearbeiten, löschen** mit der Reichweite **keine, eigene, Team, alle**. Sonderrechte wie Export, Import, Freigaben erteilen, Prozesse veröffentlichen, Kampagnen versenden, API-Schlüssel, Einstellungen, Benutzer und Audit werden getrennt vergeben.

Regeln: Niemand kann Rechte vergeben, die er selbst nicht hat, und der letzte Inhaber ist geschützt.

## 5. Erste Daten

- Kontakte per CSV importieren (*Kontakte*, Abschnitt *CSV-Import*) oder aus HubSpot bzw. Brevo übernehmen (*Listen & Felder → Wechsel*).
- Ein Formular anlegen und auf der Website einbetten (siehe [Funktionen](funktionen.md#formulare)).
- Unter *Prozesse* eine Best-Practice-Vorlage übernehmen, z. B. „Lead-Eingang“.

Weiter mit den [Funktionen](funktionen.md).
