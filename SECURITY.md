# Security Policy / Sicherheitsrichtlinie

## Reporting a vulnerability

**Please do not report security vulnerabilities through public GitHub issues, discussions or pull requests.**

Send your report to **info@kundrio.de**, or use GitHub's private vulnerability reporting ("Report a vulnerability" on the Security tab of this repository).

Please include:

- the affected version or commit and the component (app, worker, deployment files)
- steps to reproduce, ideally with a proof of concept
- the impact as you understand it (for example data of another sub-account readable, authentication bypass)
- whether the issue is already public or known to others

What you can expect:

- confirmation of receipt within **3 working days**
- a first assessment within **10 working days**
- regular updates until the issue is fixed; we aim to fix critical issues within 30 days
- credit in the release notes if you wish

We ask you to:

- test only against your own installation, never against hosted instances or data of other people
- not access, change or delete data that is not yours, and stop as soon as you reach other people's data
- give us reasonable time to fix the issue before you disclose it (coordinated disclosure, 90 days by default)

We will not take legal action against researchers who follow these rules in good faith.

## Supported versions

Until version 1.0, only the latest release and the `main` branch receive security fixes.

## Scope

In scope: the code in this repository, including the deployment files in `deploy/`. Out of scope: third-party services (payment, messaging, calendar providers) and findings that require a compromised administrator account or physical access.

---

## Sicherheitslücke melden

**Bitte Sicherheitslücken nicht in öffentlichen Issues, Diskussionen oder Pull Requests melden.**

Schicke deinen Bericht an **info@kundrio.de** oder nutze die private Meldung von GitHub („Report a vulnerability“ im Reiter *Security*).

Bitte gib an:

- betroffene Version bzw. Commit und Bestandteil (App, Worker, Deploy-Dateien)
- Schritte zum Nachstellen, am besten mit Proof of Concept
- die Auswirkung, wie du sie einschätzt (zum Beispiel Daten eines anderen Sub-Accounts lesbar, Anmeldung umgehbar)
- ob die Lücke schon öffentlich oder anderen bekannt ist

Was du erwarten kannst:

- Eingangsbestätigung innerhalb von **3 Werktagen**
- eine erste Einschätzung innerhalb von **10 Werktagen**
- regelmäßige Rückmeldung bis zur Behebung; kritische Lücken beheben wir möglichst innerhalb von 30 Tagen
- Nennung in den Release-Notizen, wenn du das möchtest

Wir bitten dich:

- nur gegen deine eigene Installation zu testen, nie gegen gehostete Instanzen oder Daten anderer
- keine fremden Daten abzurufen, zu ändern oder zu löschen und aufzuhören, sobald du auf fremde Daten stößt
- uns angemessen Zeit zur Behebung zu geben, bevor du die Lücke veröffentlichst (koordinierte Offenlegung, standardmäßig 90 Tage)

Gegen Personen, die sich in gutem Glauben an diese Regeln halten, gehen wir rechtlich nicht vor.
