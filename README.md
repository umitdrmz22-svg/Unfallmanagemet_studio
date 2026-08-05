# Unfallmanagement Studio

Regelbasiertes Unfall- und Maßnahmenmanagement für deutsche Betriebe – ohne KI-Dienst und ohne KI-Kosten.

## Funktionsumfang

- Ereignismeldung mit Sofortmaßnahmen und Beweissicherung
- Regelbasierte betriebliche Vorprüfung nach § 8 und § 193 SGB VII
- Prüfung auf mögliche Sondermitteilungen nach § 18 GefStoffV und § 19 BetrSichV
- D-Arzt-Prüfhinweise
- Strukturierte Unfalluntersuchung
- 5-Why-Analyse mit statischen Leitfragen und Warnung vor reinen Schuldzuweisungen
- Maßnahmenmanagement mit STOP-Hierarchie
- Wöchentliche E-Mail-Erinnerungen bis zum Status **Erledigt**
- Bei Fristüberschreitung: **Fristverlängerung beantragen** oder **Führungskraft informieren**
- Audit-Historie, Wirksamkeitskontrolle und JSON-Datensicherung
- Lokaler Demo-Betrieb oder geschützter Mehrbenutzerbetrieb mit Supabase

## 1. Sofort testen

Die Anwendung funktioniert ohne Installation als statische Website.

```bash
python3 -m http.server 8080
```

Danach `http://localhost:8080` öffnen. Standardmäßig läuft die Anwendung im lokalen Demo-Betrieb und speichert Daten ausschließlich im Browser.

> Im lokalen Demo-Betrieb keine realen Gesundheits- oder Personaldaten verarbeiten. Automatische E-Mails sind dort deaktiviert.

## 2. GitHub Pages

Der Workflow `.github/workflows/deploy-pages.yml` stellt den Inhalt des Repositories automatisch bereit. Unter **Settings → Pages** muss als Quelle **GitHub Actions** gewählt werden.

## 3. Produktivbetrieb mit Supabase

### Datenbank

1. Supabase-Projekt anlegen.
2. `supabase/schema.sql` im Supabase SQL Editor ausführen.
3. Ersten Benutzer über Supabase Auth anlegen.
4. In `profiles` die Rolle des Administrators auf `admin` oder `ehs` setzen.

### Frontend konfigurieren

`config.example.js` nach `config.js` übertragen und Werte eintragen:

```js
window.UNFALL_CONFIG = {
  appName: "Unfallmanagement Studio",
  mode: "supabase",
  supabaseUrl: "https://YOUR_PROJECT.supabase.co",
  supabaseAnonKey: "YOUR_PUBLIC_ANON_KEY",
  functionsBaseUrl: "https://YOUR_PROJECT.supabase.co/functions/v1",
  siteName: "Ihr Standort",
  defaultReminderWeekday: 1,
  legalReviewDate: "2026-08-05"
};
```

Der Supabase-Anon-Key ist für das Frontend vorgesehen. Der Service-Role-Key darf niemals in `config.js` oder im Browser gespeichert werden.

## 4. E-Mail-Funktionen ohne KI

Die E-Mails werden über Resend versandt. Resend kann durch einen anderen E-Mail-Provider ersetzt werden; in den Edge Functions ist nur der HTTP-Aufruf anzupassen.

### Edge Functions bereitstellen

```bash
supabase functions deploy weekly-reminders --no-verify-jwt
supabase functions deploy task-notification
```

Secrets setzen:

```bash
supabase secrets set \
  RESEND_API_KEY="re_xxxxxxxxx" \
  MAIL_FROM="Unfallmanagement <noreply@ihre-domain.de>" \
  APP_URL="https://ihre-seite.example" \
  WEEKLY_JOB_TOKEN="LANGES-ZUFAELLIGES-GEHEIMNIS"
```

`SUPABASE_URL`, `SUPABASE_ANON_KEY` und `SUPABASE_SERVICE_ROLE_KEY` werden in Supabase Edge Functions standardmäßig bereitgestellt.

### GitHub-Secrets für den Wochenlauf

Unter **Settings → Secrets and variables → Actions** anlegen:

- `WEEKLY_REMINDER_FUNCTION_URL`  
  Beispiel: `https://YOUR_PROJECT.supabase.co/functions/v1/weekly-reminders`
- `WEEKLY_JOB_TOKEN`  
  Derselbe geheime Wert wie in den Supabase-Secrets.

Der Workflow läuft montags um 06:00 UTC. Er versendet pro verantwortlicher E-Mail-Adresse eine gebündelte Liste aller noch offenen Maßnahmen. Erledigte Maßnahmen werden nicht mehr berücksichtigt.

## 5. Eskalationslogik

Bei einer überfälligen Maßnahme erscheinen zwei Schaltflächen:

### Fristverlängerung beantragen

- neue Frist und Begründung sind Pflichtfelder;
- Änderung wird in der Historie protokolliert;
- Führungskraft erhält eine E-Mail, verantwortliche Person eine Kopie;
- die wöchentliche Erinnerung läuft bis zur Erledigung weiter.

### Führungskraft informieren

- nur möglich, wenn eine Führungskraft-E-Mail hinterlegt ist;
- Eskalation wird mit Zeitstempel protokolliert;
- Führungskraft erhält eine E-Mail, verantwortliche Person eine Kopie.

## 6. Rechtliche Systemgrenzen

Die Anwendung erstellt eine betriebliche Vorprüfung. Sie trifft keine verbindliche Entscheidung über die Anerkennung eines Arbeits- oder Wegeunfalls. Diese Entscheidung obliegt dem zuständigen Unfallversicherungsträger.

Hinterlegte amtliche Quellen:

- [§ 8 SGB VII](https://www.gesetze-im-internet.de/sgb_7/__8.html)
- [§ 193 SGB VII](https://www.gesetze-im-internet.de/sgb_7/__193.html)
- [DGUV – Unfallanzeige](https://www.dguv.de/de/ihr_partner/unternehmen/unfallanzeige/index.jsp)
- [DGUV – Durchgangsarzt](https://www.dguv.de/de/ihr_partner/arbeitnehmer/arbeitsunfall/index.jsp)
- [§ 18 GefStoffV](https://www.gesetze-im-internet.de/gefstoffv_2010/__18.html)
- [§ 19 BetrSichV](https://www.gesetze-im-internet.de/betrsichv_2015/__19.html)
- [§ 5 ArbSchG](https://www.gesetze-im-internet.de/arbschg/__5.html)
- [§ 6 ArbSchG](https://www.gesetze-im-internet.de/arbschg/__6.html)

Stand der hinterlegten Regelprüfung: **5. August 2026**.

## 7. Datenschutz und Betrieb

Vor Produktivsetzung sind mindestens festzulegen:

- Rollen- und Berechtigungskonzept
- zulässige Datenfelder und Datenminimierung
- Aufbewahrungs- und Löschfristen je Dokumentart
- technische und organisatorische Maßnahmen
- Protokollierung und regelmäßige Berechtigungsprüfung
- Auftragsverarbeitungsverträge mit Hosting- und E-Mail-Anbietern
- standortspezifische Sondermeldepflichten und Genehmigungsauflagen

Medizinische Diagnosen und ausführliche Behandlungsdaten gehören nicht in die allgemeine Unfallakte.
