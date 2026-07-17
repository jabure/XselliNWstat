# Xselli's Stats-Rechner – Server-Version

Diese Version läuft komplett auf deinem eigenen Server, in einem Docker-Container.
Kein separates Datenbank-System nötig – alles wird als einfache JSON-Dateien
gespeichert. Das braucht sehr wenig Arbeitsspeicher und CPU (typisch unter 50–80 MB RAM).

## Was ist neu gegenüber der Browser-Version?

- Passwörter werden mit **bcrypt gehasht** gespeichert (nicht im Klartext).
- Login läuft über ein **Token (JWT)** – sicherer als der bisherige Klartext-Login.
- Alle Daten liegen auf **deinem Server**, nicht mehr im Speicher der Claude-Website.

## Voraussetzungen

- Docker und Docker Compose sind auf deinem Server installiert.

## Einrichtung (einmalig)

1. Diesen ganzen Ordner (`xselli-server`) auf deinen Server kopieren.
2. Datei `.env.example` kopieren und in `.env` umbenennen.
3. In der `.env` einen eigenen, zufälligen Wert für `JWT_SECRET` eintragen.
   Zum Erzeugen z. B. im Terminal: `openssl rand -hex 32`
4. Im Ordner ausführen:
   ```
   docker compose up -d --build
   ```
5. Fertig. Die Seite ist danach unter `http://DEINE-SERVER-IP:3000` erreichbar.

## Danach

- Neustart nach Serverneustart: passiert automatisch (`restart: unless-stopped`).
- Updates am Frontend (die `public/index.html`): Datei ersetzen, dann
  `docker compose restart` – kein Rebuild nötig, da sie nur ausgeliefert,
  nicht eingebaut wird.
- Updates am Server-Code (`server.js`, `package.json`): danach
  `docker compose up -d --build` erneut ausführen.

## Wo liegen die Daten?

Im Unterordner `data/`, der auf dem Server liegt (nicht im Container –
übersteht also auch ein `docker compose down`):
- `data/users.json` – Benutzerkonten (Passwort als Hash, keine Klartexte)
- `data/chars/*.json` – je eine Datei pro Charakter
- `data/shared.json` – Formeln, Gefährten-/Reittier-/Buff-Food-Datenbank, Presets
- `data/transfers.json` – offene Charakter-Übergaben (wer hat wem welchen Charakter angeboten)

**Backup:** Es reicht, den `data/`-Ordner regelmäßig zu kopieren.

## Reverse Proxy

Der Container hängt jetzt zusätzlich im externen Docker-Netzwerk `proxy`
(z. B. für nginx-proxy, Traefik, Caddy o.ä.). Das Netzwerk muss auf dem
Server schon existieren, sonst schlägt `docker compose up` fehl:
```
docker network create proxy
```
Falls dein Reverse-Proxy-Setup das Netzwerk schon selbst anlegt (z. B. über
dessen eigene docker-compose.yml), ist der Befehl oben nicht nötig.

## Wenn du das öffentlich (nicht nur im lokalen Netz) erreichbar machen willst

Dann brauchst du zusätzlich noch:
- **HTTPS** (z. B. über einen Reverse Proxy wie Caddy oder nginx + Let's
  Encrypt) – aktuell läuft der Server nur über einfaches HTTP.
- Ein bisschen Sorgfalt beim offenen Port (Firewall, evtl. Rate-Limiting
  gegen Login-Versuche) – dafür kann ich dir bei Bedarf noch was ergänzen.

## GitHub als einzige Quelle der Wahrheit

Dieses Projekt liegt auf GitHub (`jabure/XselliNWstat`) - das ist die einzige
verbindliche Historie. Updates kommen als `.bundle`-Datei, die **direkt auf
dieser GitHub-Historie aufbaut** (kein eigenständiges/unabhängiges Repo), damit
`git pull`/`git fetch` daraus immer sauber funktioniert, ohne `unrelated
histories`-Fehler.

**Einmalig einrichten (auf deinem Server):**
```
git clone https://github.com/jabure/XselliNWstat.git xselli-server
cd xselli-server
cp .env.example .env   # und JWT_SECRET darin anpassen
docker compose up -d --build
```

**Ein Update aus einer neuen Bundle-Datei einspielen** (z. B.
`xselli-server-updateXX.bundle`), auf einem Rechner mit Git und Zugriff auf
dein GitHub-Repo:
```
git fetch /pfad/zur/xselli-server-updateXX.bundle main
git checkout FETCH_HEAD -- .
git commit -am "Update XX"
git push origin main
```
Dein Server zieht sich die Änderung danach automatisch über den Cronjob
unten von GitHub.

## Automatisierte Updates per Git

Im Ordner liegt `update.sh` – holt per `git pull` den neuesten Stand und baut
den Container **nur dann** neu, wenn sich wirklich etwas geändert hat.

Einrichtung (einmalig, auf deinem Server):
```
crontab -e
```
Dann diese Zeile eintragen (prüft alle 15 Minuten):
```
*/15 * * * * /pfad/zu/xselli-server/update.sh >> /pfad/zu/xselli-server/update.log 2>&1
```

Damit reicht danach: du pushst eine Änderung in dein Git-Repo (z. B. von hier
aus jederzeit ein neues `public/index.html` oder `server.js`), und dein
Server zieht sich das von selbst und aktualisiert den Container – ohne dass
du selbst am Server etwas eintippen musst.

## Bekannte Absicht/Grenzen dieser einfachen Lösung

- Es gibt jetzt drei Rollen (jede hat auch die Rechte der niedrigeren):
  **Moderator** (Gefährten/Reittiere/Buff Food bearbeiten), **Coadmin**
  (zusätzlich Formeln), **Admin** (zusätzlich Benutzerübersicht & Rollen
  vergeben). Der erste Admin ist, wer sich mit dem Namen aus `ADMIN_USERNAME`
  registriert; weitere Rollen vergibt dieser danach über den Reiter "Benutzer"
  im Frontend. Lesen der Presets/Formeln bleibt für alle offen, sonst könnten
  die Rechner der anderen nicht mehr rechnen.
- Es gibt kein "Passwort vergessen"; wer sein Passwort verliert, braucht
  einen neuen Account (oder du bearbeitest `data/users.json` von Hand).
- Bei sehr vielen gleichzeitigen Schreibvorgängen auf denselben Charakter
  könnten sich Speicherungen theoretisch überschreiben (unwahrscheinlich bei
  einer Gilde, da jeder nur seinen eigenen Charakter speichert).
- **Charaktere an andere Benutzer senden (als Kopie):** Über den Account-
  Bereich kann jeder Benutzer bei seinen eigenen Charakteren auf "Senden"
  klicken und einen anderen, bereits registrierten Benutzernamen als
  Empfänger angeben. Es wird dabei **immer eine Kopie** übertragen - das
  eigene Original bleibt unverändert erhalten. Der Empfänger sieht die
  Anfrage oben im Account-Bereich und muss sie erst annehmen oder ablehnen;
  erst nach "Annehmen" bekommt er einen eigenen, neuen Charakter mit denselben
  Daten (automatisch umbenannt, z. B. "Name (von Absender)", da Namen global
  eindeutig sein müssen). Solange die Anfrage noch offen ist, kann der
  Absender sie über "Senden abbrechen" auch wieder zurückziehen. Der
  Empfänger muss bereits ein Konto haben; man kann nicht per E-Mail o. Ä.
  zur Registrierung einladen.
