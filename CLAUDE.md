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
  **Seit v0.15.9 (Nutzerwunsch):** neue Checkbox #insMitStartkosten
  (Zustand: insignieMitStartkosten, Default FALSE) - die Kosten der
  Start-Insignie(n) selbst fließen NUR ein, wenn angekreuzt. Ohne Haken:
  gesamt = kostenFuel; mit Haken: gesamt = kostenFuel + kostenStartInsignien.
  Checkbox lebt im "rechtsHtml"-Zweig (existiert nur wenn zielIdx>startIdx),
  Listener-Zuweisung deshalb mit null-Check abgesichert. Verifiziert am
  Referenzbeispiel: grün-Gesamt ohne Haken 2.375.000, mit Haken 3.525.000
  (=2.375.000 + 1.150.000 Kosten der mystisch-Start-Insignie).
- **Seit v0.16.0: zwei echte Gruppenplaner-Bugs gefixt, beide fielen erst
  bei echten Button-Klicks auf, NICHT bei direktem Funktionsaufruf im Test
  (Lehre: UI-Tests IMMER per .click() auf den echten Button, nicht per
  win.irgendeineFunktion(name) - sonst wird kaputtes onclick-HTML nie
  entdeckt).**
  1) "Bearbeiten" tat nichts: `onclick="...${JSON.stringify(c.name)}..."`
     erzeugt `"Name"` mit LITERALEN Anführungszeichen, die mit dem
     umgebenden onclick="..."-Attribut kollidieren -> kaputtes HTML, die
     Zuweisung bricht mitten im Attribut ab. Betraf renderGpCharList
     (Bearbeiten/Löschen) UND renderGpPlanList (Öffnen/Löschen der Pläne).
     FIX: nie mehr Namen/Strings direkt per JSON.stringify in ein
     onclick="..."-Attribut einbetten. Stattdessen entweder (a) Index ins
     Array übergeben und im Handler frisch nachschlagen (gpEditCharacterByIndex,
     gpMyCharsOrder-Array; gpOpenPlan(gpPlans[i].name) mit reinem Integer im
     onclick) - das etablierte, sichere Muster im Rest der App (siehe
     confirmDeleteCharacterByIndex), oder (b) wie gpAddRefRow bereits tat:
     `.replace(/"/g,'&quot;')` auf das JSON anwenden.
  2) Besitz-Listen (Artefakte/Mounts/...) ließen sich nicht aufklappen:
     renderGpCharEditor baute die Accordion-divs mit id="acc-gpchar-X",
     aber der onclick rief toggleDmgAccordion('gpchar-X') auf, das
     id="acc-dmg-gpchar-X" erwartet (Präfix "acc-dmg-" ist in der Funktion
     hart kodiert) - ID-Mismatch, Funktion fand das Element nie. Div-ID auf
     "acc-dmg-gpchar-X" korrigiert.
- **Seit v0.17.0: Board-Erweiterungen (Nutzerwunsch).**
  - Gruppe hat jetzt g.modus ('dungeon'|'trial') statt boolean g.trial.
    Rückwärtskompatibel: renderGpPlanBoard() normalisiert alte gespeicherte
    Pläne beim Anzeigen (`if(!g.modus) g.modus = g.trial ? 'trial' : 'dungeon'`).
    gpSetGroupModus(gi, modus) verdoppelt die Zeilen NUR wenn die Gruppe
    genau die Standardgröße hat (5->10 bei dungeon->trial, 10->5 mit
    confirm() bei trial->dungeon) - bei von Hand angepassten Zeilenzahlen
    wird nur der Modus/die Party-Spalte umgestellt, nichts wird ungefragt
    gelöscht.
  - Rolle einer Zeile ist jetzt ein <select> (gpUpdateRowRolle), kein
    statisches typ-badge mehr - dadurch lässt sich eine Zeile nachträglich
    DPS<->Heiler<->Tank umschalten statt löschen+neu anlegen zu müssen.
    Farblich wie vorher über .typ-select-dps/-heal/-tank.
  - Spieler-Auswahl war zuerst ein <select> + separates, extra Zeile
    einnehmendes Textfeld ("__frei__"-Sonderwert) - **auf Nutzerwunsch in
    v0.17.1 durch EIN einziges Kombifeld ersetzt** (kein zusätzliches
    Fenster/keine zusätzliche Zeile mehr): `<input type="text"
    list="gpCharDatalist">` + eine gemeinsame `<datalist id="gpCharDatalist">`
    (einmal pro Board-Render, alle Zeilen teilen sie sich). Direkt reintippen
    oder aus der nativen Browser-Vorschlagsliste wählen. Abgleich passiert
    NUR bei onchange (Blur/Commit), NICHT bei oninput - sonst wäre bei jedem
    Tastendruck ein komplettes Re-Render nötig gewesen (Fokus-Verlust-Bug,
    siehe unten). gpResolveRowSpieler(gi,ri,val): exakter Treffer gegen
    gpCharLabelMap() ("Name (Konto)" -> charKey) verknüpft den Charakter,
    sonst gilt der getippte Text als row.freierName (kein "__frei__"-Sonder-
    wert mehr - charKey ist jetzt einfach '' wenn nicht verknüpft).
    gpRowSpielerText(row) liefert den Anzeigetext fürs Eingabefeld (Name des
    verknüpften Charakters ODER row.freierName). Rückwärtskompatibel: alte
    Zeilen mit charKey==='__frei__' werden beim Anzeigen auf charKey=''
    normalisiert (renderGpPlanBoard, gleiche Stelle wie die g.modus-Migration).
  - TEST-FALLE (wieder reingelaufen): win.currentGpPlanData ist immer
    undefined - top-level let/const hängen NICHT an window (nur
    function-Deklarationen tun das). GP-Board-Tests IMMER über das DOM
    verifizieren (Zeilenanzahl zählen, Radio-/Select-Werte lesen), nie über
    win.currentGpPlanData....
- **Seit v0.18.0: fünf Erweiterungen (Nutzer-Review-Runde).**
  1) Rev-Versionsschutz für gp/plans (wie bei shared.json presets/formulas):
     PUT erwartet optional rev, gibt bei veralteter rev 409 zurück, sonst
     neue rev. Alte Pläne ohne gespeichertes rev-Feld werden beim GET auf 0
     normalisiert (data.rev = data.rev || 0). Frontend: currentGpPlanRev
     wird bei gpOpenPlan gesetzt und bei gpSaveCurrentPlan mitgeschickt/
     aktualisiert.
  2) gpRenamePlanPrompt()/gpDuplicatePlan() als Buttons in der Plan-Liste -
     der Rename-Endpunkt existierte serverseitig schon lange, war aber nie
     an die UI angebunden. Duplicate legt einen neuen Plan mit denselben
     Gruppen unter neuem Namen an (Original bleibt unverändert).
  3) Duplikat-Spieler-Erkennung über den GANZEN Plan (alle Gruppen, nicht
     nur innerhalb einer): spielerZaehlung-Map (Schlüssel 'c:'+charKey oder
     'f:'+freierName.trim().toLowerCase()), Zeilen mit Zähler>1 bekommen
     rote Umrandung + Tooltip am Spieler-Kombifeld.
  4) Nur-Ansicht (gpPlanAnsichtModus, Button #gpAnsichtToggleBtn): schlichte
     Lese-Darstellung ohne jegliche select/input-Elemente zum Screenshotten;
     gpPlanAnsichtHtml() rendert nur ausgefüllte Zeilen als reinen Text.
     Wird beim Öffnen eines Plans (gpOpenPlan) immer auf false zurückgesetzt.
  5) GET /api/admin/stats (Rolle admin) liefert userCount/roleCounts/
     totalCharacters/totalGpCharacters/totalGpPlans/sharedRev/
     sharedUpdatedAt - rein aus vorhandenen Daten aggregiert, keine neue
     Datenhaltung. Neue Karte "Statistik" ganz oben auf der Benutzer-Seite
     (renderAdminStats(), Kachel-Optik wie beim Insignienrechner/
     .ins-stat-row wiederverwendet).
  TEST-FALLE (in dieser Runde passiert): ein rev-Konflikt-Test hat einen
  Plan mit groups:[] überschrieben - ein SPÄTERER Test (Nur-Ansicht) lief
  auf demselben Plan weiter und fand fälschlich "keine Eingabefelder", weil
  schlicht keine Gruppen mehr da waren (nicht weil Ansicht/Bearbeitung kaputt
  war). Bei Tests, die denselben Datensatz über mehrere Abschnitte hinweg
  wiederverwenden, IMMER prüfen ob ein früherer Abschnitt Daten geleert hat -
  im Zweifel vor einem UI-Test den benötigten Inhalt frisch anlegen
  (hier: win.gpAddGroup() vor dem Nur-Ansicht-Test).
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
- **Seit v0.26.0: Optimierer auch für freie Namen + Lieblingsartefakte
  (Nutzervorgabe).**
  - **Freie Namen (kein zuweisbarer Charakter) werden jetzt auch optimiert**:
    `gpApplyBestSetup` verlangte bisher zwingend `row.charKey`. Jetzt reicht
    auch nur `row.freierName` - ohne Charakter-Profil gibt es keine
    Besitz-Checkliste, also wird für jede Kategorie die KOMPLETTE
    Referenzliste als "Besitz" angenommen (`kat.liste().map(e=>e.name)`
    statt der Checkliste) - "es wird angenommen, dass die Leute alles haben"
    (Nutzerzitat). Rollen-Regeln (Mount/Gefährten-Bonus bei DPS
    unangetastet, Rollen-Präferenz bei Artefakten) gelten dabei unverändert
    weiter.
  - **Lieblingsartefakte**: neues Feld `data.lieblingsartefakte` je
    Charakter, eigener Chip-Bereich im Charakter-Editor unterhalb der
    Besitz-Checkliste - Optionen sind bewusst NUR die schon angekreuzten
    Besitz-Artefakte (ein Favorit ohne Besitz wäre wirkungslos). Wird im
    Optimierer (`gpBestOwned`, neuer 4. Parameter `favoriten`) NUR als
    Tiebreaker bei GLEICHEM Rangwert verwendet (Nutzervorgabe "max dps geht
    in der Regel vor") - ein objektiv höherer Wert gewinnt immer, Favoriten
    entscheiden nur zwischen gleichwertigen Kandidaten. `favKey:
    'lieblingsartefakte'` an der Artefakte-Kategorie markiert, für welche
    Kategorie das gilt (aktuell nur Artefakte, wie angefragt). Server:
    `GP_CHAR_ALLOWED_KEYS` um `'lieblingsartefakte'` erweitert.
  - Smoke-Test um freien-Namen-Optimierung (DPS und Tank, inkl. Zusammen-
    spiel mit der Rollen-Präferenz) und den Favoriten-Tiebreaker erweitert -
    dabei fiel auf, dass ein älterer Test (Icon-Upload) den ERSTEN
    Tabelleneintrag umbenennt statt eine neue Zeile anzulegen - "Demogorgon's
    Reach" heißt seither "Icon-Test-Artefakt" (Buff-Wert 10,56 % bleibt
    aber der höchste in der Liste) - betroffene Erwartungswerte angepasst.
    Alle 223 Checks grün.
- **Seit v0.25.0: Gruppenplaner-Charakternamen nachträglich änderbar
  (Nutzerwunsch).**
  - Neuer Server-Endpunkt `POST /api/gp/characters/:name/rename` (analog zu
    `/api/characters/:name/rename` für Stats-Charaktere) - benennt die
    Datenablage-Datei um und aktualisiert `user.gpCharacters`. Da der Name
    Teil des `charKey` ist (`"Account::Charname"`), werden zusätzlich ALLE
    Gruppenplaner-Pläne (nicht nur eigene, `GP_PLAN_DIR` wird komplett
    durchsucht) nach Zeilen mit dem alten `charKey` durchsucht und auf den
    neuen umgeschrieben - sonst würde eine bestehende Aufstellung den
    Charakter beim Umbenennen "verlieren" (charKey zeigt ins Leere).
  - Frontend: neuer "Umbenennen"-Knopf pro Charakter in "Meine Charaktere"
    (`gpRenameCharacterByIndex`), per `prompt()` wie beim bestehenden
    Plan-Umbenennen - der `@Accountname`-Suffix wird wie bei der Anlage
    automatisch wieder angehängt, man tippt nur den Kurznamen.
  - Smoke-Test um Button-Test (inkl. "Restdaten wie Handle bleiben erhalten")
    und einen isolierten Wegwerf-Charakter/-Plan-Test für das
    charKey-Nachziehen in Plänen erweitert - alle 214 Checks grün.
- **Seit v0.24.0: Ingame-Handle, Rollen-Passung, Ausrüstung bei Charakter-
  wechsel erhalten, "Plan speichern" schließt nicht mehr, Icon im Select
  (Nutzervorgabe, mehrteilige Anfrage).**
  - **Ingame-Handle**: neues Feld `data.handle` je GP-Charakter, frei
    editierbar (eigenes Eingabefeld bei der Anlage UND im Charakter-Editor,
    `gpEditHandle`) - bewusst UNABHÄNGIG vom Website-Login-Accountnamen, da
    beides in der Praxis auseinanderfallen kann. `gpDisplayName(c)` zeigt bei
    gesetztem Handle `Kurzname@Handle` statt des bisherigen Rückfalls
    `Name (Konto)`; "Meine Charaktere" zeigt den Handle zusätzlich als
    eigenes `<span>`. Server: `GP_CHAR_ALLOWED_KEYS` um `'handle'` erweitert
    (sonst hätte die PUT-Route das Feld beim Speichern stillschweigend
    verworfen - die Route ersetzt die Charakterdatei komplett durch die
    erlaubten Felder aus dem Body).
  - **Mehrfachbelegung jetzt über den Handle statt den Charakter-Key**:
    `gpRowIdentity(row)` in `renderGpPlanBoard` nutzt bei zugewiesenem
    Charakter dessen Handle (falls gepflegt) als Identität für die
    planweite Duplikat-Prüfung - fällt dadurch jetzt auch auf, wenn
    dieselbe reale Person mit ZWEI VERSCHIEDENEN eigenen Charakteren
    doppelt eingetragen wird. Ohne gepflegten Handle bleibt der
    Charakter-Key der Rückfall (altes Verhalten unverändert).
  - **Rollen-Passung**: `gpRolleMismatch(rec, rolle)` prüft beim Zuweisen
    (`gpResolveRowSpieler`) die Rollen-Checkboxen des Charakters (`data.
    rollen`) gegen die Zeilen-Rolle; bei Nichtpassung (z. B. reiner Tank auf
    einen Heiler-Slot) wird die Zuweisung mit `alert()` abgelehnt und das
    Feld bleibt unverändert. Charaktere OHNE jede angekreuzte Rolle werden
    NICHT blockiert (sonst wäre ein Charakter ohne gepflegte Rollen-Angabe
    nirgends einsetzbar - schlechter als gar keine Prüfung).
  - **Ausrüstung bleibt beim Charakterwechsel erhalten**: die bisherige
    "beim Charakterwechsel Artefakt/Mount/.../GefährtenBonus automatisch auf
    '' zurücksetzen"-Logik in `gpResolveRowSpieler` wurde ersatzlos entfernt
    (Nutzerwunsch: "wenn schon Ausrüstung drinnen steht, soll das so
    übernommen werden"). Was der neu zugewiesene Charakter laut Checkliste
    NICHT besitzt, markiert `gpFieldNichtVorhanden(row, kat)` stattdessen rot
    (gleiche Optik wie die Artefakt-Duplikat-Markierung) - der aktuelle Wert
    wird dafür in `selectFor` IMMER als Option mit aufgenommen (auch wenn er
    nach der gefilterten Besitzliste eigentlich nicht mehr vorkäme), sonst
    würde er beim Wechsel unbemerkt aus der Anzeige verschwinden. Ohne
    gepflegte Checkliste für die Kategorie (owned leer/fehlt) gibt es nichts
    zu prüfen -> keine rote Markierung (gilt automatisch auch für freie
    Namen ohne Charakter-Profil).
  - **"Plan speichern" schließt den Plan nicht mehr**: `gpSaveCurrentPlan()`
    rief bisher nur `ensureGpPlansLoaded(true)` auf, was intern IMMER
    `renderGpPlanList()` auslöst - und die leert `#gpPlanBoard`
    unbedingt (bekannte Falle, s. weiter unten in dieser Datei). Jetzt wird
    danach explizit `renderGpPlanBoard()` nachgezogen, das Board bleibt
    sichtbar.
  - **Icon im Auswahlfeld statt daneben, größer**: neue Funktion
    `gpFieldIconHtml(kat, name)` (reines `<img class="gp-field-icon">`,
    ersetzt für die Board-Selects das bisherige Pill-Badge) wird per CSS
    (`.gp-select-icon-wrap{position:relative}`, `.gp-field-icon{position:
    absolute; left:8px; ...; width:26px; height:26px}`) über die linke
    Innenseite des Selects gelegt; das Select bekommt bei vorhandenem Icon
    zusätzlich die Klasse `gp-has-icon` (mehr `padding-left`, damit der
    Options-Text nicht unter dem Icon liegt). Das kompakte Pill-Badge
    (`gpDmgBadgeHtml`, mit Text-Icon-Kombination) bleibt weiterhin für die
    Nur-Ansicht (reiner Text statt Select) im Einsatz.
  - Smoke-Test um u. a. Rollen-Passung-Ablehnung, Handle-Duplikat über zwei
    verschiedene Charaktere, Ausrüstungs-Erhalt+Rot-Markierung, "Plan
    speichern schließt nicht" und Handle-Editor-Feld erweitert - alle 205
    Checks grün.
- **Seit v0.23.0: Rollenabhängige Optimierer-Logik + zwei neue Referenzfelder
  (Nutzervorgabe, Screenshot des Optimierer-Ergebnisses).**
  - **Mount & Gefährten-Bonus bei DPS unangetastet**: DPS haben laut Nutzer
    ein reines Selbstbuff-Mount und Supports übernehmen die wichtigen
    Gefährten-Boni - `GP_BESITZ_KATEGORIEN[...].optimizeRollen` (`['Tank',
    'Heiler']`) sorgt dafür, dass `gpBestOwned` für DPS-Zeilen `null`
    zurückgibt ("nicht anfassen", bewusst verschieden von `''` = "leeren").
    Gilt für Mount, Mount-Ausrüstungsbonus UND Gefährten-Verstärkung.
  - **Mount-Ausrüstungsbonus "fix" für Supports**: die Kategorie hat kein
    `dmgKey` (nichts zum Sortieren) - `gpBestOwned` übernimmt für Tank/
    Heiler jetzt trotzdem einfach den (einzigen/ersten) eigenen Eintrag
    ("fix einplanen" laut Nutzer), weiterhin `null` für DPS.
  - **Gefährte: Schaden statt Buff bei DPS**: neues Feld `schaden` in der
    Gefährten-Referenzliste (`GP_REF_SPECS`, Spalte "Schaden (DPS)" neben
    "Dmg Buff % (Support)"). `dpsDmgKey:'schaden'` an der Kategorie lässt
    `gpBestOwned` bei Rolle DPS nach diesem Feld statt nach `buff` sortieren;
    Tank/Heiler bleiben unverändert beim Support-Buff.
  - **Artefakte: "Bevorzugt für"-Rolle**: neues `select`-Feld `rolle` (Werte
    `''/DPS/Heiler/Tank`) in der Artefakte-Referenzliste. `roleKey:'rolle'`
    an der Kategorie lässt `gpBestOwned` unter den eigenen Artefakten zuerst
    nach zur Zeilen-Rolle passenden (nach `buff` sortiert) suchen, erst wenn
    keins passt gilt wie bisher schlicht der höchste `buff`-Wert. Wird auch
    im Options-Text (`gpOptionLabel`, ` · Tank`) und im Badge-Tooltip
    (`gpDmgBadgeHtml`) angezeigt.
  - **Referenz-Editor unterstützt jetzt `select`-Felder**: `gpRefFieldHtml`
    rendert bei `f.select` (Array erlaubter Werte) ein `<select>` statt
    `<input type=text>`; `gpCollectRefList` liest über `[data-field=...]`
    (statt `input[data-field=...]`) jetzt beide Feldtypen ein.
  - `gpBestOwned(kat, ownedNames, rolle)` hat jetzt einen dritten Parameter
    (vorher wurde die Rolle gar nicht berücksichtigt); `gpApplyBestSetup`
    reicht `row.rolle` durch und lässt die Kategorie bei `!kat.dmgKey &&
    !kat.optimizeRollen` weiterhin komplett aus (z. B. falls künftig weitere
    reine Freitext-Kategorien ohne jede Optimierer-Anbindung dazukommen).
  - Smoke-Test grundlegend überarbeitet: testet jetzt separat den DPS- und
    den Support-Pfad derselben Zeile (Rollenwechsel per `gpUpdateRowRolle`
    mitten im Test) - alle 188 Checks grün.
- **Seit v0.22.3: Icon steht vor statt unter dem Auswahlfeld (Nutzerkorrektur
  zu v0.22.2, per Screenshot).**
  - Neue CSS-Klasse `.gp-select-icon-wrap` (flex, `gap:6px`) umschließt Badge
    + Select in den Board-Zellen Artefakt/Mount; das Select bekommt darin
    `width:auto;flex:1` statt der globalen `width:100%`, sonst würde es das
    Badge weiterhin in eine neue Zeile drängen. In der Nur-Ansicht (reiner
    Text statt Select) steht das Icon jetzt ebenso vor statt nach dem Namen.
  - Rein visuelle Änderung, `gpDmgBadgeHtml`/`gpOptionLabel` selbst
    unverändert. Alle 178 Smoke-Test-Checks bleiben grün (Badge-Selektoren
    finden das Icon weiterhin über `select.parentElement`, da Select und
    Badge weiterhin Geschwister im selben Wrapper-Element sind).
- **Seit v0.22.2: Doppelte Prozent-Anzeige entfernt (Nutzerkorrektur zu
  v0.22.1, per Screenshot: Wert stand im Select-Text UND nochmal im Badge
  darunter).**
  - `gpDmgBadgeHtml` zeigt jetzt NUR noch das Icon, keinen %-Text mehr - der
    Wert steht seit v0.22.1 bereits im Options-Text des Selects
    (`gpOptionLabel`). Kein Icon hinterlegt -> Badge bleibt leer (wie
    vorher schon bei fehlendem Wert).
- **Seit v0.22.1: Dmg-Buff-Prozentwert direkt in der Dropdown-Option
  (Nutzerwunsch, siehe Screenshot: Wert sollte schon BEIM Auswählen sichtbar
  sein, nicht erst danach als Badge).**
  - `gpOptionLabel(kat, name)`: hängt bei Kategorien mit `dmgKey` (Artefakte,
    Mounts, Gefährten, Gefährten-Verstärkung) den Wert als `Name (X %)` an
    den Options-Text an; ohne `dmgKey`/ohne hinterlegten Wert bleibt es beim
    reinen Namen (z. B. Mount-Ausrüstungsbonus). Nur der sichtbare
    Options-Text ändert sich, `value` bleibt der reine Name - keine
    Auswirkung auf Speichern/Vergleich/Duplikat-Erkennung.
  - Das Badge neben dem Select (`gpDmgBadgeHtml`, seit v0.20.0) bleibt
    zusätzlich bestehen (zeigt Icon + Wert nach der Auswahl kompakt an,
    ohne das Dropdown öffnen zu müssen) - beide Anzeigen ergänzen sich.
- **Seit v0.22.0: Rollen-Überbelegung- und Artefakt-Duplikat-Warnungen im
  Gruppenplaner-Board (Nutzerwunsch).**
  - `gpRoleWarnings(g)`: prüft je Gruppe auf mehr als 1 Tank bzw. 1 Heiler
    (Standard-5er-Zusammensetzung), gezählt werden nur BESETZTE Zeilen
    (charKey oder freierName gesetzt). Bei Trial (`g.modus==='trial'`) wird
    getrennt je Party A/B geprüft (`row.party`), da jede Party ihre eigene
    5er-Zusammensetzung braucht; Zeilen ohne Party-Zuordnung fließen NICHT
    ein. Reine Warnung (`⚠ ...`, `var(--off)`) unter dem Gruppen-Header,
    verhindert nichts - Sonderaufstellungen bleiben möglich. Wird sowohl im
    Bearbeitungs- als auch im Nur-Ansicht-Modus angezeigt.
  - Artefakt-Duplikate: INNERHALB derselben Gruppe (nicht gruppenübergreifend,
    anders als die bestehende Spieler-Duplikatserkennung) wird gezählt, wie
    oft ein Artefaktname vorkommt (`artefaktZaehlung`); bei >1 wird das
    Auswahlfeld genauso markiert wie doppelt vergebene Spieler
    (`border-color:var(--off)` + Tooltip). In der Nur-Ansicht wird die
    Artefakt-Zelle stattdessen farbig/fett hervorgehoben (kein `<select>`
    dort). Bewusst nur Artefakte (nicht Mount/Gefährte) geprüft, da dort der
    Buff-Stacking-Konflikt am relevantesten ist.
  Smoke-Test um 2 neue Checks erweitert (Rollen-Warnung erscheint bei 2
  Tanks in einer Party, Artefakt-Duplikat wird im Select markiert).
- **Seit v0.21.0: "Bestes eigenes Setup"-Optimierer im Gruppenplaner-Board
  (Nutzerwunsch, inspiriert von nwo-guides.gitlab.io/neverwinter-party-
  optimizer - deren tatsächliche Optimierungslogik ließ sich technisch NICHT
  auslesen, da es eine reine JS-SPA ist und das Web-Fetch-Werkzeug nur die
  initiale Menü-Ansicht rendert, keine Interaktion/Deep-Links. Diese
  Implementierung ist deshalb komplett eigenständig entworfen, nicht
  nachgebaut.)**
  - `GP_BESITZ_KATEGORIEN[]` hat jetzt zusätzlich `rowField` (Name des
    zugehörigen Board-Zeilenfelds aus `gpNewSlot()`) - macht Summen-/
    Optimierer-Code generisch über alle 5 Kategorien statt 5x fast
    identischen Code.
  - Gefährten UND Gefährten-Verstärkung haben jetzt auch ein optionales
    numerisches `buff`-Feld in der Referenzliste (`GP_REF_SPECS`), genau wie
    Artefakte (`buff`) und Mounts (`dmgBonus`) es schon hatten - dadurch
    `dmgKey:'buff'` auch bei diesen beiden Kategorien in
    `GP_BESITZ_KATEGORIEN`. Mount-Ausrüstungsbonus bleibt bewusst ohne
    dmgKey (rein beschreibend). Alte Einträge ohne diesen Wert werden beim
    nächsten Speichern automatisch auf 0 normalisiert (`parsePct('')` -> 0,
    wie bei jedem numerischen Feld in diesem Projekt) - keine Migration
    nötig, aber bis Officer echte Werte eintragen, zeigt das Dmg-Buff-Badge
    für diese Einträge "0 %" an (kein Bug, nur unbefüllte Daten).
  - `gpBestOwned(kat, ownedNames)`: wählt aus den ANGEKREUZTEN Besitz-
    Einträgen einer Kategorie den mit dem höchsten `dmgKey`-Wert.
    `gpApplyBestSetup(row)`: wendet das für ALLE dmgKey-Kategorien auf eine
    Board-Zeile an (mutiert `row`, rendert NICHT selbst - das übernimmt der
    Aufrufer, damit `gpOptimizeGroup` nicht pro Zeile neu rendern muss).
    `gpOptimizeRow(gi,ri)` (🏆-Knopf pro Zeile) und `gpOptimizeGroup(gi)`
    (🏆-Knopf im Gruppen-Footer, wendet es auf JEDE Zeile mit zugewiesenem
    Charakter an) sind die beiden UI-Einstiege.
  - BEWUSSTE Design-Entscheidung: pro CHARAKTER optimieren, kein fremder
    Cross-Zeilen-Zuteilungsalgorithmus ("welcher Spieler bekommt welches
    Artefakt") - in Neverwinter rüstet sich jeder Spieler selbst aus, es
    gibt nichts zwischen Zeilen aufzuteilen. "Gruppe optimieren" heißt hier
    also: die Pro-Charakter-Auswahl für jede Zeile der Gruppe einmal
    anwenden. `gpGroupDmgBuffSum` (Σ-Anzeige im Gruppen-Header, seit v0.20.0)
    wurde beim Umbau ebenfalls generisch über `rowField`/`dmgKey`
    geschrieben statt nur Artefakt+Mount zu summieren - berücksichtigt jetzt
    auch Gefährten/Gefährten-Verstärkung.
  - Test-Falle beim Bauen des Smoke-Tests: eine Referenzlisten-Änderung
    direkt per Roh-API (`PUT /api/shared/presets`) am Frontend vorbei
    gespeichert wird vom Frontend NICHT bemerkt, weil `gpArtefakte`/
    `gpGefaehrten`/... top-level `let`-Variablen sind, die nur beim
    initialen Laden bzw. innerhalb von `gpSaveReferenzlisten()` selbst
    aktualisiert werden - für Tests immer über die echte Referenzlisten-
    Seite (DOM-Felder befüllen + `gpSaveReferenzlisten()` aufrufen) gehen,
    nicht die Server-API direkt patchen. Zweite Falle: `showGpPage(...)`
    leert `#gpPlanBoard` IMMER beim Wechsel zur Seite "planung"
    (`renderGpPlanList()` tut das unbedingt) - `currentGpPlanData` bleibt
    zwar erhalten, das Board muss aber explizit mit `renderGpPlanBoard()`
    neu gezeichnet werden, sonst ist es einfach leer.
  Smoke-Test um 8 neue Checks erweitert (Referenzfelder vorhanden, Buff-
  Werte werden gespeichert, Optimierer wählt pro Zeile UND pro Gruppe
  korrekt den höherwertigen Mount/Gefährten).
- **Seit v0.20.0: zwei weitere Gruppenplaner-Erweiterungen (Nutzerwunsch).**
  1) Referenzlisten-Icon ist jetzt ein Datei-Upload statt eines Text-URL-Felds
     (`gpRefIconFileHtml`/`gpHandleIconUpload`, neue Konstante `GPREF_ICON_SIZE
     = 48`). Läuft KOMPLETT im Browser: FileReader liest die gewählte Datei,
     ein `<canvas>` schneidet sie quadratisch zu (mittiger Crop auf die
     kürzere Seite) und verkleinert auf 48×48, `canvas.toDataURL('image/png')`
     liefert eine data:URL, die in dasselbe (jetzt `type=hidden`) `icon`-Feld
     geschrieben wird wie vorher die URL - `gpCollectRefList` und alle
     Anzeige-Stellen (`gpRefIconImgHtml`) brauchten dafür KEINE Änderung, weil
     `icon` weiterhin einfach ein String ist. Kein neuer Server-Endpunkt, kein
     Multer/Multipart nötig. Ein "Icon entfernen"-Knopf (`gpClearIconField`)
     setzt das Feld zurück auf `GPREF_BLANK_ICON`. Alte, per URL gesetzte
     Icons funktionieren unverändert weiter (data:- und https:-URLs sind für
     `<img src>` gleichwertig) - beim Testen in jsdom lässt sich der
     Resize-Pfad (Image/canvas) nicht sauber simulieren, der Smoke-Test prüft
     deshalb nur Feldstruktur + Clear-Knopf, nicht den Pixel-Pfad.
  2) Dmg-Buff wird im Board jetzt sichtbar: `GP_BESITZ_KATEGORIEN[].dmgKey`
     markiert, welches Feld einer Kategorie ein Dmg-Buff ist (`artefakte` ->
     `buff`, `mounts` -> `dmgBonus`, die anderen 3 Kategorien haben keins).
     `gpDmgBadgeHtml(kat, name)` rendert ein kleines Badge (Icon + %-Wert)
     direkt neben der Artefakt-/Mount-Auswahl einer Board-Zeile UND in der
     Nur-Ansicht. `gpGroupDmgBuffSum(g)` addiert Artefakt-Buff + Mount-
     Dmg-Bonus über alle Zeilen einer Gruppe zu einer "Σ Dmg-Buff"-Anzeige im
     Gruppen-Header - AUSDRÜCKLICH nur grobe Orientierung (Tooltip weist
     darauf hin), keine Nachbildung der echten Spiel-Stapelmechanik.
  Smoke-Test erweitert: Icon-Feldstruktur (file statt text) + Clear-Knopf,
  Dmg-Buff-Badge zeigt den korrekten Mount-Bonus (Pegasus, 7,89 %), Σ-Anzeige
  im Gruppen-Header vorhanden.
- **Seit v0.19.0: drei Gruppenplaner-Erweiterungen (Nutzerwunsch).**
  1) Referenzlisten-Editor (Presets-Unterseite "Referenzlisten") ist jetzt eine
     echte `<table class="gpref-table">` statt einer Karte pro Eintrag
     (Nutzerwunsch "platzsparender") - eine Tabellenzeile pro Eintrag. Jede
     Zeile hat zusätzlich eine Icon-Spalte (`icon`-Feld, einfache Bild-URL,
     kein Upload) mit Live-Vorschau (`gpRefIconImgHtml`, `GPREF_BLANK_ICON` als
     1x1-Platzhalter-PNG, `onerror` fällt bei kaputter URL zurück). `icon` ist
     KEIN Feld aus `GP_REF_SPECS[].fields`, sondern wird in `gpRefRowHtml`
     immer zusätzlich gerendert/gesammelt (`gpCollectRefList` liest es separat
     aus `input[data-field="icon"]`) - beim Hinzufügen eines 6. Referenztyps
     NICHT vergessen, dass die Icon-Spalte automatisch mitkommt, ohne sie in
     `fields` eintragen zu müssen.
  2) Beim GP-Charakter-Anlegen (`gpCreateCharacter`) wird der gespeicherte Name
     jetzt IMMER zu `Charname@Accountname` zusammengesetzt (ein evtl. selbst
     eingetipptes `@...` wird vorher abgeschnitten) - schützt vor Verwechslung
     bei gleichnamigen Charakteren verschiedener Accounts. `gpDisplayName(c)`
     zeigt den vollen Namen, WENN er ein `@` enthält, sonst (ältere Charaktere
     von vor diesem Update) den alten Rückfall `Name (Konto)` - überall
     verwendet, wo bisher `${c.name} (${c.owner})` von Hand gebaut wurde
     (`gpCharLabelMap`, `gpRowSpielerText`, Board-Datalist). Auf der eigenen
     "Meine Charaktere"-Liste wird der `@Accountname`-Teil zur Lesbarkeit
     wieder abgeschnitten (`gpOwnDisplayName` - nur eine Anzeige-Kürzung, der
     volle Name bleibt in der Datenbank/im Vergleich/Board unverändert).
  3) "Meine Charaktere" + Charakter-Editor kompakter/übersichtlicher: die
     Besitz-Checklisten (Artefakte/Mounts/...) sind jetzt ein `.besitz-grid`
     aus `.besitz-chip`-Pillen (mit Icon aus der Referenzliste) statt einer
     Checkbox pro Zeile. Die Zeichen-Liste selbst zeigt zusätzlich ein
     Klassen-Emoji (`GP_KLASSE_ICON`, rein dekorativ) und eine kompakte Reihe
     der Icons aller angekreuzten Besitz-Einträge (`gpOwnedIconsHtml`, auf 8
     Icons gedeckelt mit "+N"-Rest).
  Smoke-Test erweitert: neues Charakter-Namensformat, `<table>`-Struktur der
  Referenzliste, Icon wird über `PUT /api/shared/presets` mitgespeichert und
  taucht als `<img>` in der Besitz-Checkliste wieder auf.
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
