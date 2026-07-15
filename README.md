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

## Von hier auf deinen eigenen Git-Server bringen

Du hast zwei Dateien bekommen: `xselli-server.bundle` (komplette Git-Historie)
und `xselli-server.tar.gz` (nur die Dateien, ohne Git). Für automatisierte
Updates brauchst du die `.bundle`-Datei und ein eigenes Git-Repo (z. B. auf
GitHub, GitLab oder einem selbst gehosteten Gitea/Forgejo).

**Einmalig einrichten:**
1. Leeres, privates Repo bei GitHub/GitLab/Gitea anlegen (z. B. `xselli-stats-rechner`).
2. Auf einem Rechner mit Git (z. B. deinem PC oder direkt dem Server):
   ```
   git clone xselli-server.bundle xselli-server
   cd xselli-server
   git remote add origin <URL-deines-leeren-Repos>
   git push -u origin master
   ```
3. Auf deinem Server das Repo von dort klonen:
   ```
   git clone <URL-deines-Repos> xselli-server
   cd xselli-server
   cp .env.example .env   # und JWT_SECRET darin anpassen
   docker compose up -d --build
   ```

Ab jetzt reicht es, Änderungen in dein Repo zu pushen (z. B. wenn ich dir hier
eine aktualisierte `index.html` gebe) - dein Server holt sie sich über den
Cronjob unten von selbst.

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

- Presets & Formeln können nur noch von Benutzern mit Admin-Rechten bearbeitet
  werden. Der erste Admin ist, wer sich mit dem Namen aus `ADMIN_USERNAME`
  registriert; weitere Admins lassen sich danach über die Benutzerübersicht
  im Frontend (Reiter "Presets & Formeln") ernennen. Lesen bleibt für alle
  offen, sonst könnten die Rechner der anderen nicht mehr rechnen.
- Es gibt kein "Passwort vergessen"; wer sein Passwort verliert, braucht
  einen neuen Account (oder du bearbeitest `data/users.json` von Hand).
- Bei sehr vielen gleichzeitigen Schreibvorgängen auf denselben Charakter
  könnten sich Speicherungen theoretisch überschreiben (unwahrscheinlich bei
  einer Gilde, da jeder nur seinen eigenen Charakter speichert).
