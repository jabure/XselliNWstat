# Xselli's Stats-Rechner

Ein Stats-Rechner für Neverwinter Online, gebaut für eine Gilde: jeder trägt
die Werte seines Charakters ein (Ausrüstung, Gefährten, Reittiere, Buff Food)
und bekommt daraus automatisch berechnet, wie gut die eigenen Stats ausgenutzt
sind, wie viel Schaden/Heilung die Fähigkeiten ungefähr machen und wie viel
man als Tank aushält - inklusive Formeln, die aus dem echten Spielverhalten
(Neverwinter-Wiki, Community-Guides, eigene Excel-Referenzwerte) nachgebaut
und mit echten Zahlen gegengeprüft wurden.

## Wofür ist das gedacht?

Neverwinter hat viele Stats mit Caps (Softcaps), die man mit Ausrüstung,
Gefährten, Reittier-Buffs und Buff Food ausreizen muss. Von Hand zu verfolgen,
wie viel man von jedem Cap schon hat, wie viel Ausrüstung/Boni beitragen und
was ein bestimmter Stat am Ende tatsächlich für den eigenen Schaden bringt,
ist mühsam. Der Rechner nimmt das ab: einmal die Werte eintragen, und er zeigt
sofort Ampelfarben (erfüllt/zu wenig/zu viel), Diagramme zum Grenznutzen jedes
Stats und eine fertige Schadens-/Heilungs-/Tank-Einschätzung.

## Die Seiten im Überblick

**Rechner** - die Hauptseite. Oben die Charakter-Grunddaten (Gegenstandsstufe,
Klasse, Vorbildpfad) mit drei Ringen, die auf einen Blick zeigen, wie nah man
im Schnitt an den Caps für Offensive/Defensive/Heilung ist. Darunter die
Stat-Tabelle (Kraft, Zielgenauigkeit, Kampfvorteil, Kritwert, Kritschaden,
Verteidigung, Wahrnehmung, Krit-Vermeidung, Robustheit, Trefferpunkte,
Schadensreduzierung, Ausdauerzugewinn, Wehrhaftigkeit, Kontrollbonus/-resistenz,
Heilungs-Stats ...), gefüllt aus den eigenen "Aktuelle Werte/%"-Eingaben plus
allem, was rechts unter "Ausrüstung & Boni" eingetragen ist (Ausrüstungsteile,
Gefährten, Reittier-Gruppenbuffs, Buff Food in den Kategorien Event-Essen,
Festungsessen, Elixier, Trank, Gürtel Item und Utility). Zwischen den Feldern
lässt sich mit den Pfeiltasten wie in einer Tabellenkalkulation springen.

**Schadensberechnung** - rechnet aus den Gesamt-Stats eine Schadens-, eine
Heilungs- und eine Tank-Einschätzung, jeweils mit allen Zwischenschritten,
einer verständlichen Erklärung der Formel und einer Grafik, die zeigt, wie
stark sich +1 % in jedem Stat gerade auswirkt (abnehmender Grenznutzen). Ein
Schalter pro Stat lässt sich außerdem "aktiv"/"aus" setzen, um live zu
vergleichen, was ein zusätzlicher Prozentpunkt an genau diesem Stat bringen
würde.

**Presets** (ab Rolle Moderator) - die gemeinsame Datenbank für Gefährten,
Reittier-Buffs und Buff Food, aus der sich auf der Rechner-Seite jeder per
Dropdown bedient. Änderungen hier gelten sofort für alle.

**Formeln** (ab Rolle Coadmin) - die komplette Rechenlogik als editierbarer
Text (Softcap-Formel, Delta, sowie alle Schadensformel-Bestandteile). Bei
einem Tippfehler springt die Seite automatisch auf die eingebaute
Standard-Rechnung zurück, damit nichts kaputtgeht.

**Benutzer** (ab Rolle Admin) - Übersicht aller Konten, Rollen vergeben,
Passwort zurücksetzen, Konten löschen.

## Konten & Charaktere

Jeder registriert sich mit Benutzername + Passwort und kann beliebig viele
eigene Charaktere anlegen, umbenennen, kopieren oder löschen. Charaktere
lassen sich auch als **Kopie an einen anderen Benutzer senden** - der
Empfänger muss die Kopie erst annehmen oder ablehnen, bevor sie bei ihm
auftaucht; das eigene Original bleibt davon immer unberührt.

## Rollen

Jede Rolle hat auch die Rechte der niedrigeren: **Nutzer** (eigene Charaktere)
< **Moderator** (zusätzlich Presets) < **Coadmin** (zusätzlich Formeln) <
**Admin** (zusätzlich Benutzerverwaltung).

---

## Betrieb (für Server-Admins)

Läuft komplett selbst gehostet in einem Docker-Container, Daten als einfache
JSON-Dateien unter `data/` (kein Datenbanksystem nötig).

**Einrichtung:**
```
git clone https://github.com/jabure/XselliNWstat.git xselli-server
cd xselli-server
cp .env.example .env   # JWT_SECRET darin auf einen eigenen Zufallswert setzen
docker compose up -d --build
```

**Updates:** GitHub (`jabure/XselliNWstat`) ist die einzige verbindliche
Quelle. Ein `update.sh`-Cronjob zieht neue Commits automatisch und baut den
Container bei Bedarf neu:
```
crontab -e
*/15 * * * * /pfad/zu/xselli-server/update.sh >> /pfad/zu/xselli-server/update.log 2>&1
```

**Datendateien unter `data/`:**
- `users.json` - Konten (Passwort gehasht)
- `chars/*.json` - je eine Datei pro Charakter
- `shared.json` - Formeln, Gefährten-/Reittier-/Buff-Food-Datenbank, Presets
- `transfers.json` - offene Charakter-Kopie-Angebote

**Grenzen der einfachen Lösung:** kein „Passwort vergessen" (nur Admin kann
zurücksetzen); bei sehr vielen gleichzeitigen Speicherungen auf denselben
Charakter könnte theoretisch die letzte Speicherung gewinnen (in der Praxis
unproblematisch, da jeder nur an eigenen Charakteren schreibt).
