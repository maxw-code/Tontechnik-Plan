# Tontechnikplan

Webseite für den monatlichen Technikerdienst-Plan – komplett auf dem eigenen Server, ohne externe Dienste.

| Datei | Zweck |
|---|---|
| `index.html`, `styles.css`, `app.js` | die Webseite |
| `api.php` | Server-Schnittstelle: speichert den Plan, Anmeldung, Kalender |
| `config.php` | **Einstellungen: Passwort** |
| `data/` | wird automatisch angelegt: Plan und tägliche Sicherungen |

## Installation

Voraussetzung: Webserver (Apache oder nginx) mit **PHP 7.4 oder neuer**. Eine Datenbank ist nicht nötig.

1. In `config.php` bei `edit_password` ein eigenes Team-Passwort eintragen.
2. Alle Dateien in ein Verzeichnis auf dem Server kopieren, z. B. `/var/www/technik/`.
3. Der Webserver (PHP) muss dort den Ordner `data/` anlegen und beschreiben dürfen, z. B.:
   `mkdir data && chown www-data:www-data data`
4. Den Ordner `data/` vor direktem Abruf schützen:
   - **Apache:** passiert automatisch (`data/.htaccess` wird angelegt).
   - **nginx:** in der Server-Konfiguration ergänzen:
     ```
     location ^~ /data/ { deny all; }
     ```
     (bei einem Unterverzeichnis entsprechend `/technik/data/`)
5. Seite im Browser öffnen. Beim ersten Anmelden über „Bearbeiten“ werden die Personen und Regeltermine gespeichert –
   Pläne gibt es noch keine. Dann mit **🎲 Zufallsplan** den ersten Monat (November) erstellen.

HTTPS wird dringend empfohlen (z. B. mit Let's Encrypt), da das Passwort übertragen wird.

## Bedienung

**Ansicht (Standard beim Öffnen)** – für alle, ohne Passwort
- Plan des aktuellen Monats, mit ‹ › blättern; die Seite aktualisiert sich selbst alle 20 Sekunden.
- **Ich bin …** auswählen: eigene nächste Dienste, eigene Einträge im Plan blau umrandet.
- **Kann nicht** bei einem eigenen Dienst → Ersatz wird automatisch eingetragen (Team-Passwort nötig, wird pro Gerät gemerkt).
  Danach erscheint ein fertiger Text für die Gruppe zum Kopieren.
- **📅 Dienste im Handy-Kalender abonnieren** → alle eigenen Dienste erscheinen im Kalender des Handys, inkl. Erinnerung; Änderungen kommen automatisch nach.
- **Plan als Text**: ganzen Monat als Text kopieren, z. B. um einen neuen Plan in die Gruppe zu schicken.
- **Letzte Änderungen** (unter dem Plan): jede Änderung als fertiger Gruppentext mit **📋 Kopieren**.
- **📊 Statistik**: Dienste pro Person für 4 Wochen / 3, 6, 12 Monate / dieses Jahr / letztes Jahr / gesamt – nach Studio, Mischpult, allein, Sonntag/Wochentag, Absagen, Verlauf pro Woche bzw. Monat.

**Bearbeiten** („✎ Bearbeiten“ + Team-Passwort)
- 🎲 Zufallsplan, Ereignisse, Verfügbarkeit („kann nicht mittwochs“), Regeltermine, Einstellungen.
- Beim Klick auf **✓ Fertig** fasst die Seite alle Änderungen an bereits geplanten Diensten zusammen
  (umbesetzt, verlegt, gestrichen, neu) und zeigt den Text für die Gruppe. Ein komplett neu erstellter Monat zählt nicht als Änderung.
- Einträge unter „Letzte Änderungen“ lassen sich im Bearbeitungsmodus mit × entfernen.
- **Jährliche Regeltermine** (Tab „Termine“ → Regeltermin → Wiederholung): *Festes Datum* (z. B. Heiligabend 24.12. 16:00,
  Weihnachten 25.12. 10:00 – beide sind voreingestellt) oder *Ostern* (Karfreitag, Ostermontag, Himmelfahrt, Pfingsten …,
  das Datum wird jedes Jahr berechnet). Sie werden mit „Regeltermine einfügen“ / Zufallsplan vor den wöchentlichen Terminen
  angelegt und haben zur gleichen Uhrzeit Vorrang. Mit „Ersetzt die anderen Regeltermine an diesem Tag“ entfallen an dem Tag
  alle wöchentlichen Termine. Bereits angelegte Termine eines Monats werden nicht verändert.

## Daten & Sicherung

- `data/plan.json` – der Plan; `data/backups/` – Stand jedes Tages (60 Tage).
- Wiederherstellen: gewünschte Sicherung aus `data/backups/` nach `data/plan.json` kopieren und `data/rev.json` löschen.
- Passwort ändern: in `config.php` – danach sind alle Geräte abgemeldet.
- Ändern zwei Personen gleichzeitig, wird nichts überschrieben: der Zweite bekommt den neuesten Stand und einen Hinweis.

Ohne Server (Datei `index.html` direkt geöffnet) funktioniert alles außer dem Kalender-Abo – gespeichert wird dann nur im Browser.
