#!/bin/sh
# Holt den neuesten Stand aus git und baut den Container bei Bedarf neu.
# Macht nichts, wenn es keine Änderungen gibt (kein unnötiger Rebuild/Neustart).
#
# Einrichtung als Cronjob (z.B. alle 15 Minuten prüfen):
#   crontab -e
#   */15 * * * * /pfad/zu/xselli-server/update.sh >> /pfad/zu/xselli-server/update.log 2>&1

set -e
cd "$(dirname "$0")"

BEFORE=$(git rev-parse HEAD)
git pull --ff-only
AFTER=$(git rev-parse HEAD)

if [ "$BEFORE" != "$AFTER" ]; then
  echo "$(date): Neue Version gefunden ($BEFORE -> $AFTER), baue neu..."
  docker compose up -d --build
else
  echo "$(date): Keine Änderungen, nichts zu tun."
fi
