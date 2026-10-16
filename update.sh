#!/bin/sh
# Holt den neuesten Stand aus git und baut den Container bei Bedarf neu.
# Macht nichts, wenn es keine Änderungen gibt (kein unnötiger Rebuild/Neustart).
#
# NEU: Nach dem Neustart wird abgewartet, ob die App wirklich "healthy" wird. Schlägt der
# Build fehl oder meldet sich die neue Version nicht, wird automatisch auf den letzten
# funktionierenden Stand zurückgerollt. Der fehlerhafte Commit wird in .deploy-bad-commit
# vermerkt und NICHT erneut versucht, bis ein neuerer Commit auf GitHub liegt.
#
# Einrichtung als Cronjob (z.B. alle 15 Minuten prüfen):
#   crontab -e
#   */15 * * * * /pfad/zu/xselli-server/update.sh >> /pfad/zu/xselli-server/update.log 2>&1

set -e
cd "$(dirname "$0")"

# Schaltet Buildx' Standard-Provenance-Attestations ab. Ohne das versucht Docker bei
# jedem Build, den aktuellen Git-Commit als Bild-Metadaten einzubetten - was in der
# Cronjob-Umgebung mit der Warnung "git was not found in the system" scheitert
# (harmlos, bricht den Build nicht ab, ist aber unnötiges Rauschen im Log).
export BUILDX_NO_DEFAULT_ATTESTATIONS=1

BAD_FILE=.deploy-bad-commit
WAIT_SECONDS=120

# Wartet, bis der Container "healthy" ist. 0 = ja, 1 = nein (unhealthy oder Zeitüberschreitung).
wait_healthy(){
  ID=$(docker compose ps -q 2>/dev/null | head -n 1)
  [ -n "$ID" ] || return 1
  i=0
  while [ "$i" -lt "$WAIT_SECONDS" ]; do
    STATUS=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$ID" 2>/dev/null || echo gone)
    case "$STATUS" in
      healthy) return 0 ;;
      unhealthy|gone) return 1 ;;
    esac
    sleep 5
    i=$((i + 5))
  done
  return 1
}

git fetch --quiet origin
BEFORE=$(git rev-parse HEAD)
REMOTE=$(git rev-parse '@{u}')

if [ "$BEFORE" = "$REMOTE" ]; then
  echo "$(date): Keine Änderungen, nichts zu tun."
  exit 0
fi

if [ -f "$BAD_FILE" ] && [ "$(cat "$BAD_FILE")" = "$REMOTE" ]; then
  echo "$(date): Commit $REMOTE ist als fehlerhaft vermerkt (siehe $BAD_FILE) - übersprungen, bis ein neuerer Commit kommt."
  exit 0
fi

git merge --ff-only "$REMOTE"
echo "$(date): Neue Version gefunden ($BEFORE -> $REMOTE), baue neu..."

if docker compose up -d --build && wait_healthy; then
  rm -f "$BAD_FILE"
  echo "$(date): Neue Version läuft und ist gesund."
else
  echo "$(date): FEHLER - neue Version startet nicht sauber. Rolle auf $BEFORE zurück."
  docker compose logs --tail 40 2>&1 || true
  echo "$REMOTE" > "$BAD_FILE"
  git reset --hard "$BEFORE"
  docker compose up -d --build
  echo "$(date): Rollback abgeschlossen. Der fehlerhafte Commit wird nicht erneut versucht."
  exit 1
fi
