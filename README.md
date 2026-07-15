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

**Backup:** Es reicht, den `data/`-Ordner regelmäßig zu kopieren.

## Wenn du das öffentlich (nicht nur im lokalen Netz) erreichbar machen willst

Dann brauchst du zusätzlich noch:
- **HTTPS** (z. B. über einen Reverse Proxy wie Caddy oder nginx + Let's
  Encrypt) – aktuell läuft der Server nur über einfaches HTTP.
- Ein bisschen Sorgfalt beim offenen Port (Firewall, evtl. Rate-Limiting
  gegen Login-Versuche) – dafür kann ich dir bei Bedarf noch was ergänzen.

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

- Presets & Formeln sind aktuell für **jeden angemeldeten wie auch nicht
  angemeldeten Besucher** less- und schreibbar (wie bisher). Eine
  Admin-Beschränkung darauf haben wir uns für später vorgenommen.
- Es gibt kein "Passwort vergessen"; wer sein Passwort verliert, braucht
  einen neuen Account (oder du bearbeitest `data/users.json` von Hand).
- Bei sehr vielen gleichzeitigen Schreibvorgängen auf denselben Charakter
  könnten sich Speicherungen theoretisch überschreiben (unwahrscheinlich bei
  einer Gilde, da jeder nur seinen eigenen Charakter speichert).
