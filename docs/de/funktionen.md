# Funktionen

[English](../en/features.md)

Alle Bereiche liegen im Menü des Sub-Accounts (`/sa/<kürzel>/…`). Was du siehst und ändern darfst, hängt von deiner Rolle ab (siehe [Erste Schritte](erste-schritte.md#4-team-und-rollen)).

- [Kontakte und Unternehmen](#kontakte-und-unternehmen)
- [Pipeline, Aufgaben, Tickets](#pipeline-aufgaben-tickets)
- [Formulare](#formulare)
- [E-Mail und Kampagnen](#e-mail-und-kampagnen)
- [Landingpages](#landingpages)
- [Prozesse (Automatisierung)](#prozesse-automatisierung)
- [Angebote, Rechnungen, Zahlungen](#angebote-rechnungen-zahlungen)
- [Abos und SEPA-Lastschrift](#abos-und-sepa-lastschrift)
- [Posteingang](#posteingang)
- [Kalender und Buchung](#kalender-und-buchung)
- [Analytics](#analytics)
- [KI, Wissen, MCP und Agent-API](#ki-wissen-mcp-und-agent-api)
- [Recherche und Presse](#recherche-und-presse)
- [Pflichten-Cockpit](#pflichten-cockpit)
- [Souveränitäts-Cockpit](#souveränitäts-cockpit)
- [Datenexport und DSGVO](#datenexport-und-dsgvo)
- [Wechsel von HubSpot oder Brevo](#wechsel-von-hubspot-oder-brevo)

## Kontakte und Unternehmen

- *Kontakte*: Liste mit Suche, Tags und Filtern. Die Detailseite zeigt die Zeitleiste (Mails, Formulare, Deals, Tickets, Notizen), die Einwilligungen und die Prozesse, die den Kontakt betreffen.
- **CSV-Import** auf der Kontaktseite. Spalten werden zugeordnet; Importe lösen keine Prozesse aus.
- *Unternehmen*: Kontakte werden über die E-Mail-Domain automatisch zugeordnet. Doppelte Unternehmen lassen sich zusammenführen.
- **Lifecycle-Phasen** (Subscriber, Lead, MQL, SQL, Opportunity, Kunde …) und **Zuständige** je Datensatz.
- **Lead-Echtheit**: Kundrio bewertet neue Leads (Domain, Verhalten) und markiert verdächtige Anfragen.
- *Listen & Felder*: statische Listen und eigene Felder für Kontakte und Unternehmen. Prozesse und Formulare können nur Felder nutzen, die es wirklich gibt.

## Pipeline, Aufgaben, Tickets

- *Pipeline*: Deals als Kanban. Karten per Maus oder Finger ziehen (auf dem Handy kurz halten), per Tastatur mit Leertaste, Pfeiltasten und wieder Leertaste, oder die Phase über die Auswahl auf der Karte setzen. Gewonnene Deals können per Prozess den Kontakt zum Kunden machen.
- *Aufgaben*: mit Fälligkeit und Zuständigen; überfällige Aufgaben erscheinen im Dashboard.
- *Tickets*: eigene Pipeline „Support“ mit Priorität und SLA. Gespräche aus dem Posteingang lassen sich in Tickets umwandeln.

## Formulare

1. *Formulare* → neues Formular, Felder wählen (Standardfelder und eigene Felder).
2. Für Newsletter den **Einwilligungstext** hinterlegen. Wer das Formular absendet, bekommt eine Bestätigungsmail (**Double-Opt-in**). Erst nach dem Klick wird `consentEmailAt` gesetzt; der Wortlaut zum Zeitpunkt der Bestätigung wird als Nachweis gespeichert.
3. Einbinden: Die Formularseite zeigt den Link (`/f/<id>`) und einen `<iframe>`-Code für die eigene Website.

Formulare haben ein Rate-Limit gegen Spam und einen signierten Zeitstempel. Neue Einträge lösen das Ereignis `form.submitted` aus, z. B. für den Prozess „Lead-Eingang“.

## E-Mail und Kampagnen

- **Einzelmails** aus der Kontaktseite. Mit `MAIL_MODE=capture` landen sie in Mailpit bzw. im Protokoll.
- **Kampagnen** (*E-Mail → Kampagne*): Empfänger aus Listen oder Tags, Text in Markdown mit Platzhaltern wie `{{ contact.FIRSTNAME | default: "zusammen" }}` und Vorschau. Vorlagen lassen sich als Testmail verschicken.
- **Ablauf:** *Entwurf* → *freigegeben* (eine berechtigte Person gibt frei; mit Vier-Augen-Prinzip eine andere als die erstellende) → *wird versendet* → *versendet*. Der Worker versendet in Stapeln.
- Newsletter gehen nur an Kontakte mit bestätigter Einwilligung. Jede Mail hat einen Abmeldelink und den Header `List-Unsubscribe` (One-Click).
- **Bounces und Beschwerden** kommen über den Ereignis-Eingang des Relays (`MAIL_EVENTS_SECRET`) und landen auf der **Sperrliste**. Die Sperrliste bleibt auch nach dem Löschen eines Kontakts bestehen.
- **Vorlagen** (*E-Mail → Vorlagen*) mit numerischer ID, nutzbar über die Brevo-kompatible API.
- **Brevo-kompatible API**: `POST /api/brevo/v3/smtp/email` und die Kontakte-/Listen-Endpunkte. Bestehende Anwendungen wechseln, indem sie Basis-URL und API-Schlüssel tauschen. Den Schlüssel legst du unter *API & Schnittstellen* an.

## Landingpages

1. *Landingpages* → neue Seite, optional als **KI-Entwurf** aus einer kurzen Beschreibung.
2. Im **Editor** Blöcke anordnen: 14 Blöcke wie Hero, Text, Bild, Vorteile, Preise, FAQ, Formular, Buchung, Animationen. Farben und Schriften kommen aus der Marke des Sub-Accounts.
3. **Barrierefreiheit prüfen**: Die Prüfung läuft vor dem Veröffentlichen und zeigt Probleme (Kontrast, Alternativtexte, Überschriften).
4. **Übersetzen** in weitere Sprachen des Sub-Accounts (KI-Entwurf, danach prüfen).
5. **Veröffentlichen**: erreichbar unter `/p/<kürzel>/<sprache>/<slug>`, mit JSON-LD, `sitemap.xml`, `robots.txt` und `llms.txt`.

**Eigene Domain** (*Domains*): Domain eintragen. Kundrio erkennt den DNS-Anbieter und richtet den Eintrag per API, Domain Connect oder Anleitung ein (CNAME auf `LANDING_CNAME_TARGET`, bei Apex-Domains A/AAAA). Nach der Prüfung über mehrere Resolver stellt Caddy das Zertifikat automatisch aus. Die Domain wird danach laufend überwacht.

## Prozesse (Automatisierung)

- *Prozesse* zeigt die eigenen Prozesse und **17 Best-Practice-Vorlagen** (Lead-Eingang, MQL, Deal gewonnen → Kunde, Willkommen, Auftragsbestätigung, Kickoff, Buchung, Rücklastschrift, Rechnung bezahlt …).
- Der **Flow-Editor** verbindet einen **Auslöser** (28 Arten, z. B. Formular abgesendet, Deal-Phase geändert, Tag gesetzt, Termin gebucht, Rechnung bezahlt, Erwähnung gefunden, KI-Erkennung) mit **Schritten** (27 Knotentypen: Bedingungen, Warten, Feld setzen, Aufgabe, E-Mail, Webhook, KI-Schritt …).
- Jeder Prozess zeigt sich auch **„in Worten“**, und die Prüfung meldet unbekannte Felder vor dem Veröffentlichen.
- **Testlauf** mit einem Beispiel-Datensatz, danach **veröffentlichen**. Jede Veröffentlichung ist eine neue Version; laufende Durchläufe bleiben bei ihrer Version.
- Prozesse mit **Außenwirkung** (E-Mail, Webhook) brauchen eine Freigabe durch einen Admin.
- *Läufe*: Protokoll jedes Durchlaufs mit allen Schritten und Fehlern.

Technisch schreibt jede fachliche Änderung ein Ereignis in eine Outbox. Der Worker verteilt es an passende Prozesse, und jeder Schritt läuft genau einmal, auch nach einem Absturz.

## Angebote, Rechnungen, Zahlungen

- *Angebote & Rechnungen* → neu: Positionen, Steuer, Zahlungsziel. Nummern werden fortlaufend vergeben.
- **Angebot** → Versand mit PDF → **Online-Annahme** über einen Link (`/dokument/<token>`) → **Auftragsbestätigung** → **Rechnung**.
- Jede Rechnung hat einen **GiroCode** (QR für die Überweisung) und lässt sich als **XRechnung (UBL)** herunterladen.
- **Texte** (*Angebote & Rechnungen → Texte*): Einleitung, Schluss und Mailtexte je Belegart, mit Platzhaltern.
- **Kundenportal**: Kunden sehen ihre Belege über einen persönlichen Link.
- **Bezahllinks** (*Zahlungen → Anbieter*): Mollie (inkl. Wero), Revolut oder Unzer verbinden. Mit `PAYMENTS_MODE=test` werden nur Test-Zugänge akzeptiert. Der Link erscheint auf der Rechnung, im Portal und als Platzhalter `{{ invoice.paymentLink }}`. Eine bezahlte Rechnung löst `invoice.paid` aus.
- **Kontoabgleich** (*Zahlungen → Abgleich*): Kontoauszug als CAMT.053 hochladen (oder Revolut Business verbinden). Zahlungen werden Rechnungen und Lastschriften automatisch zugeordnet, der Rest manuell.
- **Lexware Office** (*Integrationen*): Belege an Lexware übertragen (`LEXWARE_API_KEY`).

## Abos und SEPA-Lastschrift

- *Abos → Produkte*: Produkte mit Preis und Intervall.
- *Abos → Mandate*: SEPA-Mandate (wiederkehrend oder einmalig, OOFF). Die IBAN wird verschlüsselt gespeichert. Die **Gläubiger-ID** steht in den Einstellungen.
- *Abos → Lastschrift*: Kundrio erstellt fällige Rechnungen und einen Stapel als `pain.008.001.08`, den du bei deiner Bank hochlädst.
- **Rücklastschriften** werden über den Kontoabgleich erkannt und lösen `debit.returned` aus; *Mahnwesen* zeigt offene Posten.

## Posteingang

- *Posteingang → Kanäle*: E-Mail-Postfach per IMAP/SMTP, **WhatsApp Cloud API** oder **SMS über seven.io** verbinden.
- Gespräche zuweisen, **interne Notizen** schreiben, mit Tastenkürzeln erledigen, in ein **Ticket** umwandeln.
- HTML-Mails werden abgeschottet angezeigt (keine Skripte, keine Tracking-Pixel).
- WhatsApp und SMS brauchen eine Einwilligung je Kanal. Mit `MESSAGING_MODE=capture` wird nichts gesendet, nur protokolliert.

## Kalender und Buchung

- *Konto → Kalender*: eigenen Google- oder Microsoft-Kalender verbinden. Kundrio liest freie Zeiten und trägt Termine ein (mit Meet- bzw. Teams-Link).
- *Kalender → Vorlagen*: Terminarten mit Dauer, Puffer, Vorlaufzeit und beteiligten Personen.
- **Öffentliche Buchungsseite**: `/buchen/<kürzel>/<vorlage>`, auch als `<iframe>` oder als Block auf einer Landingpage. Nach der Buchung kommt eine Bestätigung mit ICS-Datei; das Ereignis `meeting.booked` steht für Prozesse bereit.
- Ohne Kalender-Verbindung gibt es einen Jitsi-Link (`JITSI_BASE_URL`) und eine ICS-Einladung per Mail.

## Analytics

- **Ohne Cookies und ohne gespeicherte IP-Adresse.** Besucher werden über einen Tages-Hash mit täglich neuem Salz gezählt.
- Landingpages werden automatisch erfasst. Für externe Websites das Snippet aus *Analytics* einbinden:
  ```html
  <script defer src="https://<deine-kundrio-domain>/api/a/script.js?ws=<kürzel>"></script>
  ```
  Die Website muss unter *Einstellungen → Erlaubte Domains* stehen.
- **KI-Crawler** (GPTBot, ClaudeBot, PerplexityBot …) werden serverseitig erkannt, auch ohne JavaScript. Besucher aus KI-Antworten erscheinen als eigene Quelle.
- **Conversions** und Umsatz-Zuordnung, **Log-Import** (*Analytics → Import*) für Server-Logs externer Websites.
- Die Agentur-Analytics (`/analytics`) fasst alle Sub-Accounts zusammen.

## KI, Wissen, MCP und Agent-API

- **KI-Aufrufe** laufen lokal (Ollama) oder über einen OpenAI-kompatiblen EU-Dienst. Jeder Aufruf wird mit Zweck und Modell protokolliert (*Souveränität → KI-Protokoll*). KI-Ergebnisse sind immer Vorschläge.
- *Wissen*: Texte, Dateien und Websites als Wissensquellen, öffentlich oder intern. Kundrio zerlegt sie in Abschnitte und speichert Vektoren in pgvector (RAG).
- *Wiki*: Seiten je Sub-Account. Die KI schlägt Änderungen vor; ein Mensch übernimmt sie.
- **Admin-MCP** (`POST /api/mcp`): 42 Werkzeuge für externe KI-Assistenten (Kontakte suchen, Deals ändern, Prozesse bauen …). Anmeldung per **OAuth 2.1** (für Konnektoren in claude.ai oder ChatGPT) oder per API-Schlüssel mit den Scopes `mcp:read` / `mcp:write` (*API & Schnittstellen → MCP*). Die Rechte sind die Schnittmenge aus Benutzerrechten und Token-Umfang. Alles mit Außenwirkung landet im **Freigabe-Eingang** (`/freigaben`).
- **Agent-API** je Sub-Account (`/api/agent/<kürzel>/info|ask|request|openapi.json|mcp`): öffentliche Schnittstelle für KI-Agenten von Besuchern. Antworten kommen nur aus öffentlichen Wissensquellen; Anfragen erzeugen einen Kontakt und eine Aufgabe, nie direkt eine Mail. Abschaltbar in den Einstellungen.

## Recherche und Presse

- **Anreicherung** (Detailseiten, *Anreicherung*): Kundrio liest Website und Impressum, findet verlinkte Social-Profile und erstellt ein KI-Profil. Jeder Wert ist ein **Vorschlag** mit Quelle und Datum; ein Mensch übernimmt ihn.
- Personen nur beruflich und nur, wenn im Sub-Account eingeschaltet (Informationspflicht nach Art. 14 DSGVO; Widerspruch per Tag `keine-anreicherung`).
- *Presse & Erwähnungen*: Treffer aus SearXNG, GDELT und RSS mit KI-Kurzfassung, Tonalität und Themen. Die **Überwachung** ist je Sub-Account einschaltbar und löst `mention.found` aus.

## Pflichten-Cockpit

*Pflichten* listet die Anforderungen aus BFSG (Barrierefreiheit), AI Act, CRA, NIS2, E-Rechnung, Mail-Authentifizierung (SPF/DKIM/DMARC), DSGVO und Souveränität. Viele Punkte prüft Kundrio automatisch (z. B. DNS-Einträge der Absenderdomain, Impressum, Einwilligungstexte). Der Rest wird mit Nachweis abgehakt.

## Souveränitäts-Cockpit

`/souveraenitaet` (Agentur-Admins) zeigt jede Verbindung nach außen mit Anbieter, Region, Zweck, „aktiv/inaktiv“ und Ersatzmöglichkeit. Verlässt eine aktive Verbindung die Region eines Sub-Accounts, erscheint eine Warnung. Dienste, die nur bei Nutzung einer Funktion aktiv werden, stehen getrennt unter „Nur bei Nutzung“. Dazu kommen KI-Nutzung je Sub-Account und das KI-Protokoll.

## Datenexport und DSGVO

- **Datenexport je Sub-Account** (*Einstellungen → Datenexport*): alle Daten als ZIP in offenen Formaten (JSON und CSV), ohne Passwörter und Embeddings. Ein Test stellt sicher, dass jede Tabelle im Export enthalten ist.
- **Auskunft (Art. 15)**: Auf der Kontaktseite *Auskunft (DSGVO)* lädt alle Daten zu einer Person als JSON.
- **Löschung (Art. 17)**: Löschen auf der Kontaktseite entfernt die Person mit allen Bezügen. Wo Aufbewahrungspflichten gelten (Rechnungen, Mandate, Abos), wird anonymisiert statt gelöscht. Die E-Mail-Adresse bleibt auf der Sperrliste, damit kein erneuter Versand erfolgt.
- **Einwilligungen** werden mit Zeitpunkt, Quelle und Wortlaut gespeichert.

## Wechsel von HubSpot oder Brevo

*Listen & Felder → Wechsel*:

- **HubSpot**: Import per Private-App-Token (Kontakte, Unternehmen, Deals, Eigenschaften) oder per CSV-Export aus HubSpot.
- **Brevo**: Import per API-Schlüssel (Kontakte, Listen, Attribute, Sperrliste) oder CSV.
- **Export** in beide Richtungen: Brevo- und HubSpot-kompatible CSV-Dateien und die Sperrliste. So kannst du Kundrio auch wieder verlassen.
