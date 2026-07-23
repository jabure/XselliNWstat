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
- **Seit v0.15.0: Gruppenplaner + Insignienrechner als DRITTE/VIERTE eigene App.**
  Oberster App-Switcher (showApp('stats'|'gruppenplaner'|'insignien'),
  #appStats/#appGruppenplaner/#appInsignien) - komplett unabhängig vom
  Statrechner, eigene Datentöpfe. GP_MIN_ROLE='moderator' (Server-Konstante
  in server.js UND Client-Konstante in index.html, beide "moderator" -
  bei Freischaltung für alle BEIDE auf 'user' ändern) gated sowohl die
  Sichtbarkeit der App-Tabs als auch JEDEN /api/gp/*-Aufruf server-seitig.
  **Seit v0.15.1:** App-Switcher sitzt jetzt GANZ OBEN LINKS in einer
  gemeinsamen .top-bar-Zeile zusammen mit dem Konto-Button rechts (VOR dem
  h1-Titel) statt darunter - Nutzerwunsch.
  **Seit v0.15.4 (Nutzerwunsch):** App-Switcher ist jetzt ein <select
  id="appSelect"> statt drei <button>-Tabs (kein #appSwitcher/#apptab-*
  mehr - falls alter Code danach sucht, ist das ein Bug). updateApp-
  SwitcherVisibility() baut die <option>-Liste komplett neu (nur 'stats'
  für normale Rollen, +gruppenplaner/insignien ab Moderator) statt einzelne
  Optionen zu verstecken. showApp() setzt zusätzlich mainTitle/mainSubtitle
  aus APP_INFO[name] - jeder Bereich hat jetzt einen EIGENEN Erklärtext
  (der lange Statrechner-Text erscheint nur noch auf der Statrechner-Seite,
  nicht mehr global sichtbar wie bis v0.15.3).
  - Insignienrechner: rein clientseitig, INSIGNIE_RATIO (feste Spielmechanik,
    NICHT editierbar) + insigniePreise (editierbar, Presets-Endpunkt).
    **Seit v0.15.1 (Nutzer-Referenz-Screenshot deckte Fehler auf):**
    insigniePreise[q] ist ein Objekt {ah, direkt} statt einer einzelnen Zahl -
    "ah" fließt in die Kettenrechnung ein (Preis, um diese Qualität zu kaufen
    und hochzustufen), "direkt" wird NUR verwendet, wenn genau diese Qualität
    als Ziel gewählt ist (Preis, um sie fertig zu kaufen). Beide können am
    Markt bewusst unterscheiden (Referenzwerte: celestisch ah=2.000.000 vs.
    direkt=2.499.999). migrateInsigniePreise() wandelt alte flache Zahlen
    (v0.15.0) automatisch in die neue Struktur um - beim Ändern dieser
    Struktur erneut IMMER eine Migration mitliefern, alte shared.json-Stände
    dürfen nicht crashen.
    **v0.15.2 war NOCHMAL FALSCH und wurde in v0.15.3 komplett ersetzt -
    Lehre daraus unten, damit das nicht ein drittes Mal passiert.**

    **Seit v0.15.3: das komplett neue, vom Nutzer explizit verifizierte
    Pulver-Modell.** Insignien verwerten (=salvage) liefert Insignien-Pulver
    (INSIGNIE_PULVER_VERWERTET pro Qualität, fest: [2,10,50,250,1250,1500]).
    JEDE Stufen-Aufwertung kostet ihren EIGENEN Pulver-Betrag
    (INSIGNIE_PULVER_KOSTEN = [10,50,250,1250,2500] für grün..mystisch,
    KEIN pauschaler Wert wie in v0.15.2 fälschlich angenommen!). Für eine
    Kette Start->Ziel mit Menge Stück: pulverBenoetigt = Menge * SUMME
    (nicht Produkt/Multiplikation!) von INSIGNIE_PULVER_KOSTEN[i] für
    i=startIdx..zielIdx-1. Verifiziert am Nutzerbeispiel: mystisch->
    celestisch (1 Stufe) braucht 2500 Pulver, gedeckt durch 1250 grüne
    Insignien (2500/2) - GENAU der vom Nutzer vorgerechnete Wert.

    Die alte v0.9-v0.15.2-Vorstellung einer "Fusion/Hochstufen-Kette per
    RATIO-Multiplikation" (INSIGNIE_RATIO, 1250*250*50*... kaskadierend)
    EXISTIERT SO NICHT und wurde ENTFERNT - sie ergab bei mehrstufigen
    Ketten astronomisch falsche Zahlen (grün->legendär: 15,6 Millionen
    grüne Insignien / 29,7 Milliarden AD, statt real ~155 grüne / ~300.000
    AD). Nur für den einzelnen Sonderfall "genau eine Stufe, Fuel-Qualität
    = Start-Qualität" kamen beide Modelle zufällig auf dieselbe Zahl - das
    hat die falsche Mehrstufen-Version lange unentdeckt gelassen. LEHRE:
    bei Spielmechanik-Rechnereien IMMER mit einem MEHRSTUFIGEN Testfall
    gegenrechnen, ein Einzelstufen-Beispiel reicht nicht zur Validierung.

    Die "Verwertungs-Qualität" (aus welcher Qualität man das Pulver
    gewinnt) ist FREI wählbar und unabhängig von Start-Qualität (Nutzer-
    Beispiel: mystisch hochstufen, aber grün als Pulver-Quelle nutzen!).
    Statt eines Dropdowns zeigt die Ergebnis-Tabelle ALLE 6 Qualitäten als
    mögliche Pulver-Quelle nebeneinander (benötigte Menge + Gesamtkosten
    inkl. der Start-Insignie(n) selbst) und markiert die günstigste
    (.best-row CSS). "Insignien-Pulver, das du schon hast"
    (insigniePulverVorhanden, rein lokaler UI-State, nicht geteilt/
    gespeichert) wird direkt von pulverBenoetigt abgezogen, bevor die
    Tabelle die benötigten Mengen pro Qualität berechnet.
    Referenztabelle wurde kompakter gemacht (Nutzerwunsch "platzsparender")
    und ist jetzt die Ergebnistabelle selbst (kein separater Info-Block
    mehr mit "Pulver (verwertet)"/"Gesamt Pulver"-Spalten - die waren
    dekorativ und sind komplett raus).
  **Seit v0.15.4: Fokus-Bug behoben.** renderInsignien() baute bei JEDER
  Zifferneingabe (Menge/Pulver/Preise) das komplette innerHTML neu auf ->
  Eingabefelder wurden dabei als neue DOM-Elemente erzeugt, Fokus/Cursor
  ging nach jedem einzelnen Tastendruck verloren. Behoben durch Aufteilung:
  renderInsignien() baut das Grundgerüst nur einmal (bei App-Eintritt oder
  Start-/Ziel-Auswahl, wo Struktur sich wirklich ändert - Fehlermeldung vs.
  Tabelle), updateInsignienErgebnis() schreibt bei jeder Zahlen-Eingabe NUR
  die berechneten Werte in bereits vorhandene Zellen per ID/textContent,
  OHNE innerHTML der Eingabefelder anzufassen. WICHTIGE REGEL für künftige
  Render-Funktionen mit Live-Eingabefeldern: niemals bei jedem 'input'-
  Event das umgebende innerHTML neu setzen, wenn sich nur Zahlen und nicht
  die Struktur ändern - sonst genau dieser Fokus-Verlust-Bug. Smoke-Test
  prüft das direkt (Marker-Property am DOM-Element muss nach mehreren
  Eingaben erhalten bleiben, sonst wurde das Element neu erzeugt).
  **Seit v0.15.6 (Nutzerscreenshot zeigte riesige Lücken):** die 4 Kennzahlen
  (Pulver benötigt/vorhanden/fehlend, Kosten Start-Insignie) sind KEINE
  Tabelle mehr, sondern .ins-stat-row/.ins-stat-Kacheln (flex-wrap) - der
  globale table{width:100%} sorgte bei einer 2-Zellen-Zeile (Label +
  colspan-Wert) für einen riesigen Leerraum, weil die Wert-Zelle den ganzen
  Rest der 100%-Breite bekam. FAUSTREGEL: für Label-Wert-Paare NIE eine
  <table> mit colspan verwenden, sondern Kacheln/Grid - Tabellen nur für
  echte mehrspaltige Daten. Die Vergleichstabelle hat jetzt
  .ins-table-narrow (max-width:640px) statt voller Breite. Der Direktkauf-
  preis ist nicht mehr eine eigene Erklär-Zeile am Seitenende, sondern
  direkt in die Fazit-Zeile eingebettet (spart eine ganze Zeile) - das
  Eingabefeld selbst gehört zum einmalig gebauten Grundgerüst
  (renderInsignien), NUR der Text davor (#insFazitText) wird von
  updateInsignienErgebnis() aktualisiert - sonst wäre der Fokus-Bug hier
  zurückgekommen (erst reingebaut, dann in genau dieser Session selbst
  entdeckt und gefixt, bevor es committed wurde - bei ähnlichen "Text +
  eingebettetes Input"-Konstrukten immer gegenchecken).
  **Seit v0.15.7 (Nutzerwunsch "weniger Platz"):** zweispaltiges Layout
  (.ins-layout, CSS Grid) - links Kennzahlen-Kacheln (.ins-col-left, jetzt
  UNTEREINANDER statt nebeneinander, da die Spalte schmaler ist), rechts
  die Vergleichstabelle+Fazit (.ins-col-right). Bricht unter 800px auf eine
  Spalte um. Ab v0.15.7 gilt außerdem: KEINE Bundle-Datei mehr erstellen/
  präsentieren, der Nutzer pusht/zieht nur noch direkt über GitHub - present_files
  nur noch für andere Artefakte nutzen, nicht mehr für xselli-server.bundle.
  **Seit v0.15.8 (Nutzerscreenshot):** Tabellenspalten-Überschriften mit
  variablem/langem Text (z.B. "Gesamt (inkl. mystisch)") machen die ganze
  Spalte künstlich breit, weil table-layout:auto sich am LÄNGSTEN Inhalt
  orientiert (Header ODER Daten) - kurze rechtsbündige Zahlen-Badges sitzen
  dann weit von der optisch erwarteten Position entfernt ("Position stimmt
  nicht"). FAUSTREGEL: Spaltenüberschriften kurz halten (hier "Gesamt"),
  variable/lange Zusatzinfos gehören in einen Hinweistext ÜBER der Tabelle,
  nicht in den <th>.
  - Gruppenplaner-Daten sind BEWUSST komplett getrennt von den Stats-
    Charakteren: eigener Ordner data/gpchars/ (users[].gpCharacters + eigene
    Whitelist GP_CHAR_ALLOWED_KEYS: klasse/rollen/besitz), eigener Ordner
    data/gpplans/ (mehrere benannte, geteilte Pläne). WICHTIG: Der Plan-
    Anzeigename MUSS im JSON-Dokument selbst stehen (data.name), NICHT aus
    dem safeName-sanitisierten Dateinamen zurückgewonnen werden - sonst gehen
    Leerzeichen/Sonderzeichen beim Auflisten verloren (genau dieser Bug ist
    beim Bauen aufgetreten und wurde gefixt - nicht wiederholen).
  - 5 geteilte Referenzlisten (gpArtefakte/gpMounts/gpMountBonus/gpGefaehrten/
    gpGefaehrtenVerstaerkung) reiten NICHT auf einem neuen Endpunkt, sondern
    einfach als zusätzliche Schlüssel auf dem bestehenden PUT /api/shared/
    presets (gleicher rev-Schutz/gleiche Historie wie companionDb & co.) -
    einmalig aus der vom Nutzer hochgeladenen Gruppenplaner-Excel importiert
    (DEFAULT_GP_*-Konstanten in index.html).
  - Board (renderGpPlanBoard): pro Zeile ein Charakter aus ALLEN gp-Charakteren
    aller Nutzer wählbar (gpCharKey = "owner::name"); die Artefakt-/Mount-/
    Gefährten-Dropdowns filtern sich dynamisch auf das, was GENAU dieser
    Charakter unter "besitz" angekreuzt hat (gpOptionsFor) - ohne Charakter
    oder ohne Besitzeinträge fällt es auf die volle Referenzliste zurück.
    Charakterwechsel setzt die 5 abhängigen Felder zurück (gpUpdateRowChar),
    sonst blieben unsichtbare/nicht mehr passende Altwerte gespeichert.
    "Trial"-Haken pro Gruppe zeigt die Party-A/B-Spalte, "Weapon/Ausrüstung
    anzeigen"-Haken die beiden sonst versteckten Spalten (Nutzerwunsch:
    ausblendbar, solange ungenutzt).
  - TEST-FALLE (mehrfach reingelaufen): `<input>`-WERTE tauchen NICHT in
    `.textContent` auf (nur reine Text-Elemente wie `<th>`/`<span>` tun das) -
    Tests auf befüllte Inputs IMMER über `.value` prüfen, nie über
    `element.textContent.includes(...)`.
- **Seit v0.14.0:** Buff-Food-Optimierer (optimizeBuffFood/runBuffFoodOptimierung
  in index.html): Knopf "Bestes Buff Food wählen" im Buff-Food-Bereich probiert
  alle Kombinationen der Nicht-Utility-Slots (category !== 'Utility') durch;
  Score seit v0.14.1 KLASSENBEWUSST (Nutzer-Vorgabe): primär die
  Klassen-Kennzahl aus computeKennzahlenForData (DPS -> totalDmg,
  Heiler -> heilWert, Tank -> ehp; ohne Klasse 0), sekundär als Tiebreaker
  die Summe der gecappten % über alle Softcap-Stats + Trefferpunkte/1e9.
  Vergleich lexikografisch über besser(a,b). Exhaustiv bis 4000
  Kombinationen, sonst Greedy in 2 Durchläufen. Utility-Slots werden nie
  angefasst (explizite Nutzer-Vorgabe). Test-Falle: die Optimierer-Rechnung
  läuft synchron und verschiebt alle Timer - Meldungs-Checks im Smoke-Test
  deshalb IMMER über waitForStatus() pollen, nie über fixe Wartezeiten. Ein Cap-Fortschrittsbalken in der Stat-Tabelle wurde bewusst
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
  orange (`delta-toolittle`); ±1 Toleranz = grün (`delta-ok`). F-Zelle trägt
  dieselbe Ampelfarbe wie das Delta. **Seit v0.14.2 (Nutzerwunsch):** die
  E-Zelle (Totale Werte) hat eine EIGENE, unabhängige Ampel (`werteAmpel()`)
  auf Basis des Werte-Caps der softcap-Formel: capC = softcap(1e12) als
  Plateau; softcap(E) < capC−1 -> orange; softcap(E−1000) >= capC -> rot
  (Werte >~1pp verschenkt); sonst grün. Formel-unabhängig, mit try/catch-
  Rückfall auf die %-Ampel. Grund: man kann zu viele WERTE haben, während
  die % noch unterm Cap liegen (fehlende I/Boni) - beides muss getrennt
  sichtbar sein. Tooltip an der E-Zelle erklärt den Zustand.
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
