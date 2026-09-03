#!/bin/sh
# Holt den neuesten Stand aus git und baut den Container bei Bedarf neu.
# Macht nichts, wenn es keine Änderungen gibt (kein unnötiger Rebuild/Neustart).
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

BEFORE=$(git rev-parse HEAD)
git pull --ff-only
AFTER=$(git rev-parse HEAD)

if [ "$BEFORE" != "$AFTER" ]; then
  echo "$(date): Neue Version gefunden ($BEFORE -> $AFTER), baue neu..."
  docker compose up -d --build
else
  echo "$(date): Keine Änderungen, nichts zu tun."
fi
