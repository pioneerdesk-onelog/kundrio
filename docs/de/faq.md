# FAQ

[English](../en/faq.md)

**Ist Kundrio Open Source?**
Kundrio ist *Fair Source* unter der FSL-1.1-ALv2. Du darfst den Code lesen, ändern und selbst betreiben, nur kein konkurrierendes kommerzielles Angebot damit machen. Jede Version wird zwei Jahre nach Erscheinen Apache-2.0, also klassisches Open Source.

**Darf ich Kundrio in meiner Firma nutzen?**
Ja. Interne Nutzung ist ausdrücklich erlaubt, auch kommerziell.

**Darf ich Kundrio für meine Kunden betreiben?**
Einrichtung, Umzug und Betreuung für Kunden, die Kundrio selbst unter der Lizenz nutzen, sind erlaubt. Kundrio als eigenen gehosteten CRM-Dienst zu verkaufen, ist ein konkurrierendes Angebot und braucht eine kommerzielle Lizenz. Im Zweifel bitte nachfragen.

**Warum ist die Oberfläche nur auf Deutsch?**
Kundrio ist für den deutschen Markt entstanden (E-Rechnung, SEPA, DSGVO, BFSG). Eine englische Oberfläche ist willkommen; bitte vorher ein Issue anlegen.

**Brauche ich eine GPU?**
Nein. Ohne KI läuft alles außer den KI-Funktionen. Für KI reicht ein OpenAI-kompatibler EU-Dienst oder ein Ollama-Server mit passenden Modellen. Das Embedding-Modell muss 1024 Dimensionen liefern.

**Gehen beim Ausprobieren E-Mails an echte Empfänger?**
Nein. `MAIL_MODE=capture` ist Standard; alle Mails landen in Mailpit. Für echten Versand musst du `MAIL_MODE=live` setzen und jede Kampagne freigeben. Mit `MAIL_LIVE_ALLOWLIST` gehen nur bestimmte Adressen echt hinaus.

**Werden Zahlungen ausgeführt?**
Nur mit `PAYMENTS_MODE=live` und Live-Zugängen der Anbieter. Im Standard `test` lehnt Kundrio Live-Schlüssel ab.

**Wie lege ich weitere Sub-Accounts an?**
Derzeit über `app/prisma/seed.ts` (Eintrag in `WORKSPACES`) und `npm run db:seed`, siehe [Erste Schritte](erste-schritte.md#2-agentur-und-sub-accounts).

**Kann ich `prisma migrate dev` oder `prisma db push` benutzen?**
Nein. Beide löschen Raw-Indizes wie den HNSW-Vektorindex. Neue Migrationen nur mit `./scripts/new-migration.sh <name>`, in Produktion `prisma migrate deploy`.

**Wie komme ich mit meinen Daten wieder heraus?**
*Einstellungen → Datenexport* liefert alle Daten des Sub-Accounts als ZIP (JSON + CSV). Dazu kommen Exporte im Brevo- und HubSpot-Format und die verschlüsselten Datenbank-Sicherungen.

**Wo melde ich eine Sicherheitslücke?**
Vertraulich, wie in [SECURITY.md](../../SECURITY.md) beschrieben, nicht als öffentliches Issue.

**Warum verweigert die App in Produktion den Start?**
Die Startprüfung meldet im Log, was fehlt, zum Beispiel ein zu kurzes `APP_SECRET`, `APP_URL` ohne `https`, fehlendes `MAIL_EVENTS_SECRET` oder `TRUST_PROXY`. Siehe [Konfiguration](konfiguration.md).
