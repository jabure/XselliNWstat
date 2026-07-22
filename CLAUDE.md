# Notizen für Claude (nicht für Endnutzer - technische Merkhilfe)

Diese Datei ist für mich (Claude) gedacht, damit ich in einer neuen
Konversation über dieses Projekt schnell wieder den Überblick habe, ohne
alles aus dem Code neu erschließen zu müssen. Für Nutzer/Setup siehe README.md.

## Was das hier ist

Ein Neverwinter-Online-Stats-Rechner für Xselli und seine Gilde.
`public/index.html` ist eine einzige, große Datei (Frontend, kein Build-Schritt,
Vanilla JS). `server.js` ist ein minimaler Express-Server mit JSON-Dateien statt
Datenbank. Beides zusammen liegt in `jabure/XselliNWstat` auf GitHub.

## Deployment-Modell - WICHTIG

**GitHub (`jabure/XselliNWstat`, Branch `main`) ist die einzige verbindliche
Quelle.** Ich habe normalerweise KEINEN dauerhaften Push-Zugriff:

- **Ohne Token vom Nutzer:** Ich klone das echte GitHub-Repo, committe meine
  Änderungen als neuen Commit obendrauf, baue daraus ein `.bundle` und gebe es
  dem Nutzer. Vorher IMMER mit `git merge-base` prüfen, dass das Bundle
  wirklich an den aktuellen GitHub-`main` andockt (kein `unrelated
  histories`-Fehler). Einspielen beim Nutzer:
  ```
  git fetch /pfad/zur/bundle-datei main
  git checkout FETCH_HEAD -- .
  git commit -am "Update XX"
  git push origin main
  ```
- **Mit Token vom Nutzer (Fine-grained PAT):** Ich kann direkt pushen:
  `git push https://<token>@github.com/jabure/XselliNWstat.git main`. Der
  Token gilt nur für diese eine Konversation (mein Dateisystem/Variablen
  überleben keine neue Konversation) - in einer neuen Konversation brauche
  ich wieder einen (neuen) Token oder falle auf den Bundle-Weg zurück. Token
  nie im Klartext committen, nur zum Pushen verwenden.
- **Versionsnummer:** `package.json` bei praktisch jedem inhaltlichen Update
  hochzählen (aktuell 0.91.0 nach "Update 46" - die Update-Nummern in den
  Commit-Messages sind mein eigenes Zählsystem, kein offizielles Schema).
- Ändert sich `server.js` oder `package.json`, braucht der Nutzer-Server einen
  **Rebuild** (`docker compose up -d --build`), nicht nur einen Neustart -
  sein `update.sh`-Cronjob macht das automatisch bei jedem Git-Änderung.
- **Seit v0.10.0 im Server eingebaut** (nicht wieder entfernen/vergessen):
  `rev`-Versionszähler in shared.json (PUT presets/formulas schickt die
  geladene rev mit, 409 bei Konflikt, Antwort enthält neue rev - Frontend
  hält sie in `sharedRev`), Shared-Historie unter data/backups/shared/
  (letzte 10), tägliches Voll-Backup unter data/backups/daily/ (letzte 7),
  Login-Bremse (10 Versuche/15 min, in-memory), POST /api/me/change-password,
  Charakter-PUT mit Schlüssel-Whitelist (CHAR_ALLOWED_KEYS) + 300-KB-Limit,
  Cache-Header (HTML no-cache, /vendor/ immutable).
- **Seit v0.11.0 zusätzlich:** Admin-Backup-Endpunkte (GET /api/admin/backups,
  GET .../backups/shared/:file (Download), POST .../restore (legt vorher den
  aktuellen Stand in die Historie, rev zählt weiter hoch), GET
  .../backups/daily/:day streamt tar.gz via busybox-tar). Frontend:
  Statusmeldungen sind ein fixierter Toast unten rechts (MutationObserver auf
  #saveStatus - Aufrufstellen setzen weiter nur textContent), Presets-/
  Formeln-Seite hat Dirty-Tracking (presetsDirty/formelnDirty, *-Markierung
  am Speichern-Knopf, confirm() in showPage, beforeunload), Charakter-
  Vergleich kann einen Snapshot einfrieren (vergleichSnapshot, Option
  __snapshot__, auch für Gäste), Passwort-ändern-Bereich ist hinter
  togglePwChange() versteckt, Login/Kontoformulare reagieren auf Enter.
- **Seit v0.12.0:** JWT enthält pw-Fingerprint (letzte 10 Zeichen des
  bcrypt-Hashes) - Passwortwechsel/Admin-Reset macht ALLE alten Tokens
  ungültig (Tokens ohne pw-Feld = Altbestand bleiben bis Ablauf gültig);
  change-password liefert deshalb ein frisches Token zurück, das Frontend
  übernimmt es. Admin-Reset setzt mustChangePassword (kommt in login- und
  /api/me-Antwort mit, Frontend öffnet dann das Passwort-Formular).
  ALLE %-/Dezimal-Eingabefelder sind Textfelder mit parsePct/formatPct
  (verstehen Punkt UND Komma; NIE wieder type=number für Prozente verwenden,
  sonst schluckt die falsche Browser-Sprache Kommaeingaben stillschweigend).
  Geteilte gegnerProfile (Presets-Whitelist-Key) mit Editor auf der
  Presets-Seite und Dropdown in der Gegner-Accordion (applyGegnerProfil,
  P.gegnerProfilName; manuelles Ändern eines gegner*-Felds setzt auf
  'eigene Werte' zurück). Gast-Eingaben können bei "Neuer Charakter" als
  Vorlage __guest__ übernommen werden. setAllStatSubgroups('stats'|'sources',
  open) = Alles auf-/zuklappen.
- **Seit v0.13.0:** Charakter-Übersicht auf der Schadensberechnung-Seite
  (Accordion acc-dmg-allechars, renderAlleCharsSection): lädt per Knopf alle
  eigenen Charaktere (uebersichtCharsData), rechnet Kennzahlen über
  computeKennzahlenForData, aktueller Charakter immer live via
  getCharDataBundle(), bester Wert pro Zeile gold (.best), Klick auf den
  Namen setzt Vergleich B. Cache wird in fullUiRefreshAfterProfileSwitch
  geleert. Seit v0.13.1 auf Nutzerwunsch umgebaut: die Übersicht ist ein
  UNTERPUNKT im Vergleichs-Accordion (renderVergleichSection hängt
  renderAlleCharsSection ans Body-Ende), Spalten sortiert nach Klassentyp
  (DPS, Heiler, Tank, Rest; TYP_RANK), Offensive/Defensive/Unterstützung als
  auf-/zuklappbare stat-subgroup-tbodies (srcgrp-ovw-*, Vorgabe je nach
  Klassentyp des geladenen Charakters, Zustand überlebt Rebuilds via
  prevSub-Map in renderUebersicht), klassenrelevante Zellen getönt
  (relev-dps/-tank/-heal; RELEVANTE_GRUPPEN = DPS:offensive, Tank:defensive,
  Heiler:offensive+support).
- **Seit v0.14.0:** Buff-Food-Optimierer (optimizeBuffFood/runBuffFoodOptimierung
  in index.html): Knopf "Bestes Buff Food wählen" im Buff-Food-Bereich probiert
  alle Kombinationen der Nicht-Utility-Slots (category !== 'Utility') durch;
  Score = Summe der GECAPPTEN % über alle Softcap-Stats (Overcap zählt nicht),
  Trefferpunkte/1e9 als Tiebreaker, gerechnet über computeAllForData (inkl.
  Wehrhaftigkeit-Umverteilung und editierbarer Formeln). Exhaustiv bis 4000
  Kombinationen, sonst Greedy in 2 Durchläufen. Utility-Slots werden nie
  angefasst (explizite Nutzer-Vorgabe). Ein Cap-Fortschrittsbalken in der Stat-Tabelle wurde bewusst
  VERWORFEN (Nutzer-Entscheidung: zu viel Platz) - nicht erneut vorschlagen.

## Wie ich hier teste (bevor ich etwas rausgebe)

Es gibt kein Test-Framework im Projekt selbst. Mein Vorgehen im Sandbox-Environment:

1. **Immer zuerst Syntax-Check:**
   ```
   node --check server.js
   python3 -c "import re; html=open('public/index.html',encoding='utf-8').read(); open('/tmp/x.js','w',encoding='utf-8').write(re.findall(r'<script>(.*?)</script>', html, re.S)[-1])"
   node --check /tmp/x.js
   ```
2. **Frontend-Logik testen mit jsdom** (in `/home/claude/node_modules`, dort
   `npm install jsdom mathjs express bcryptjs jsonwebtoken` falls nicht mehr
   vorhanden - Sandbox setzt sich zwischen Konversationen zurück).
   - mathjs muss man selbst einbinden (das echte CDN ist im Sandbox-Netzwerk
     gesperrt): CDN-`<script src=...mathjs...>` per Function-Replacer (nicht
     String-Replacer! `$&` etc. in mathjs' Code lösen sonst
     String.replace-Sonderzeichen aus) durch den Inhalt von
     `node_modules/mathjs/lib/browser/math.js` ersetzen.
   - **KRITISCH:** Top-Level `let`/`const` in einem normalen (nicht-Module)
     `<script>` landen NICHT auf `window`! `win.grunddaten`, `win.currentUser`,
     `win.myCharacters` etc. sind daher immer `undefined`, auch wenn intern
     alles stimmt. Nur `function foo(){}`-Deklarationen sind über `win.foo`
     aufrufbar. Zustände deshalb nie direkt lesen, sondern über das DOM
     prüfen (`doc.getElementById(...).value/.textContent/.classList`) oder
     über `localStorage`.
   - Viele Funktionen (`registerAccount`, `loginAccount`, ...) rufen intern
     **nicht-awaitete** (fire-and-forget) `renderAccountPanel()` o.ä. auf -
     nach so einem Aufruf immer ein `await wait(300-800)` einbauen, sonst
     sieht man im Test noch den alten DOM-Stand.
   - Bei serverabhängigen Features (Login, Charaktere, Senden/Annehmen) eine
     ECHTE Server-Instanz starten und mit echtem `fetch` ansprechen (Stub
     reicht nicht):
     ```
     setsid env DATA_DIR=/tmp/servertest/data JWT_SECRET=x PORT=NNNN node server.js > log 2>&1 < /dev/null &
     ```
     `&` alleine reicht NICHT sicher über mehrere Tool-Aufrufe hinweg -
     `setsid` benutzen. Vor jedem Neustart wirklich prüfen, dass der alte
     Prozess weg ist (`ps aux | grep node`), notfalls `pkill -9 -f server.js`
     (nicht `-f "node server.js"` - der volle Pfad in der Prozessliste
     matcht diesen String sonst nicht als Teilstring!). Im Zweifel einfach
     einen neuen Port nehmen statt mit Prozess-Resten zu kämpfen - hat mich
     in dieser Konversation mehrfach Zeit gekostet.
   - Charakternamen sind global eindeutig - bei mehreren Testläufen mit derselben
     `data/`-Datenbank IMMER eindeutige Namen verwenden oder die `data/`-Datenbank
     vorher wirklich leeren.
3. **Es gibt jetzt `dev/smoke_test.js` IM REPO** (seit v0.10.0): startet selbst
   eine Server-Instanz (Temp-DATA_DIR, zufälliger Port), testet Server-API
   (Auth, Passwort ändern, Login-Bremse, Daten-Whitelist, rev-Konflikt,
   Cache-Header) und Frontend in jsdom (Rechner, Wehrhaftigkeit, Gast-
   Zwischenspeicher, Beispielcharakter, Charakter-Vergleich inkl.
   Waffenschaden-Bonus, Passwort-Formular, Formel-Vorschau). Vorher einmalig
   `npm install jsdom` in der Sandbox, dann `node dev/smoke_test.js` aus dem
   Repo-Hauptverzeichnis. **VOR JEDEM PUSH LAUFEN LASSEN und bei neuen
   Features um passende Checks ERWEITERN** - nicht mehr ad-hoc-Testdateien in
   /home/claude anlegen. mathjs muss nicht mehr ersetzt/installiert werden:
   liegt lokal unter `public/vendor/mathjs-11.8.0.min.js` (das Frontend lädt
   es von dort, nicht mehr vom CDN).
   WICHTIG Sandbox-Falle: `pkill -9 -f server.js` am ANFANG eines
   Tool-Aufrufs bricht den ganzen Aufruf ab (returncode -1, nichts wird
   ausgeführt) - Server-Prozesse lieber vom Test selbst beenden lassen
   (macht dev/smoke_test.js) oder pkill als einzigen Befehl absetzen.

## Datenmodell-Eigenheiten

- **STAT_GROUPS / ALL_STATS** (in `public/index.html`): jeder Stat hat einen
  `type`: `softcap` (Rating-basiertes %, hat `maxPr`-Cap), `simple` (einfache
  %-Summe, oft mit `pctOnly:true`), `werteOnly` (nur ein Werte-Feld, keine %),
  `werteProzent` (Werte + zusätzlicher %-Bonus aus Ausrüstung/Boni -
  aktuell nur Trefferpunkte), `derived` (wird aus einem anderen Stat berechnet,
  z. B. Gesamte Gewirkte Heilung aus Gewirkte Heilung).
- **Delta-Konvention** (seit Update 36): `delta = F - maxPr*100`. Positiv =
  über Cap = zu viel = rot (`delta-toomuch`); negativ = unter Cap = zu wenig =
  orange (`delta-toolittle`); ±1 Toleranz = grün (`delta-ok`). E- und F-Zelle
  bekommen dieselbe Ampelfarbe wie das Delta.
- **Buff Food** ist nach echten Spielkategorien sortiert (siehe
  nw-hub.com/consumables): `FOOD_CATEGORIES = ['Event-Essen','Festungsessen',
  'Elixier','Trank','Gürtel Item','Utility']`. Utility wird von ZWEI
  Dropdown-Slots (Utility 1/2) geteilt, alle anderen haben genau einen Slot.
  Jedes Preset-Item kann `_info` (Freitext-Notiz) und `_persistsDeath` (Bool)
  als Metadaten tragen - Keys mit führendem `_` werden aus der Stat-Zeilen-Liste
  rausgefiltert (`!id.startsWith('_')`).
- **Formeln** (`formulas`-Objekt, editierbar auf der Formeln-Seite ab Coadmin):
  `eTotal`, `softcap`, `fPercent`, `fSimple`, `delta` (Rechner-Basis) sowie
  `dmgWaffenschaden`, `dmgKraftFaktor`, `dmgZgFaktor`, `dmgKvFaktor`,
  `dmgKritFaktor`, `dmgBonusFaktor`, `dmgTotal` (Schadensberechnung). Alle
  über `math.evaluate()` ausgewertet, mit `try/catch`-Rückfall auf die fest
  einprogrammierte Rechnung, falls jemand die Formel kaputt bearbeitet.
- **Schadens-/Heilungs-/Tank-Formeln wurden mehrfach gegen echte Quellen
  geprüft und korrigiert** (nicht nur aus der alten Excel übernommen!):
  - Zielgenauigkeit/Deflect: **Division**, nicht Subtraktion:
    `1/(1+Deflect*(Deflect-Härte-Zielgenauigkeit))` (Neverwinter-Wiki,
    verifiziert am Wiki-eigenen Beispiel 0,6897).
  - Kritischer Trefferschaden zählt bei **Heilung nur zur Hälfte** (Mod-19-
    Änderung, bestätigt durch Patch-Notes + Obikin89-Guide).
  - Tank/eHP-Formel 1:1 aus der Original-Excel des Nutzers nachgebaut
    (Bereich EU-EZ): `eHP = Trefferpunkte / (Verteidigung × Wahrnehmung[vs.
    Gegner-Kampfvorteil] × Krit-Vermeidung[vs. Gegner-Kritwert × -schaden] ×
    Robustheit-Kombi[wie eine eigene Deflect-Chance/-Stärke] ×
    Schadensreduzierung)`. Exakt gegen den Excel-Referenzwert 5.828.991
    verifiziert - bei Rückfragen zu Tank-Werten IMMER zuerst nach einer
    Formelzelle aus der Nutzer-Excel fragen, nicht raten.
- **Charakter-Übergabe** hat sich mehrfach gewandelt - aktueller Stand ist
  **Senden als Kopie** (`data/transfers.json`, Schlüssel = Charaktername,
  ein offenes Angebot pro Charakter): Absender bleibt Besitzer des Originals,
  Empfänger bekommt bei "Annehmen" eine neue Kopie unter automatisch
  angepasstem Namen (`Name (von Absender)`, bei Kollision durchnummeriert).
  Frühere Zwischenstände (dauerhafte Mitbearbeiter-Freigabe, dann Besitzer-
  Übergabe ohne Kopie) sind komplett abgelöst - falls im Code noch Reste wie
  `shares.json`/`invite`/`collaborators` auftauchen sollten, sind die veraltet
  und müssen raus.
- **Pfeiltasten-Navigation** zwischen Eingabefeldern: ein einziger delegierter
  `keydown`-Listener auf `document` (nicht pro Tabelle einzeln anhängen!).
  Hoch/Runter unterbindet IMMER das native ±0,01-Spinnerverhalten von
  `type=number`-Feldern (auch am Tabellenrand ohne Nachbarzeile). Links/Rechts
  funktioniert bei Zahlenfeldern grundsätzlich (kein verlässliches
  `selectionStart` dort), bei Text-Feldern nur am Anfang/Ende des Inhalts.
  Übersieht eingeklappte Untergruppen über `isRowVisible()`
  (`.stat-subgroup` ohne `.open`) - NICHT über `offsetParent`, das
  funktioniert in jsdom nicht zuverlässig.

## Stil-Konventionen, die ich beibehalten sollte

- Kommentare und Commit-Messages auf Deutsch, in der Sprache des Nutzers.
- Commit-Messages sind bewusst ausführlich (mehrere Sätze/Absätze), zählen
  "Update N" hoch und fassen mehrere Änderungen in einem Commit klar
  strukturiert zusammen.
- UI-Texte sind informell-direkt ("du"), technische Erklärungen (z. B. Formeln)
  bleiben nah an der Spielmechanik, mit Quellenverweis wo möglich.
- Vor jedem Push/jeder Bundle-Erstellung: Syntax-Check + mindestens ein
  gezielter Test der neuen Funktion + kompletter Lauf von `smoke_test.js`
  (falls in der Sandbox noch vorhanden) für Regressionen.
