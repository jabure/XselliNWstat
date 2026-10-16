#!/bin/sh
# Der Datenordner kommt als Bind-Mount vom Host und gehört dort meist root (frühere
# Versionen liefen als root). Einmalig beim Start die Besitzer auf "node" umstellen,
# dann die Rechte abgeben - der Server selbst läuft nie als root.
set -e
if [ "$(id -u)" = "0" ]; then
  mkdir -p "$DATA_DIR"
  find "$DATA_DIR" ! -user node -exec chown node:node {} + 2>/dev/null || true
  exec su-exec node "$@"
fi
exec "$@"
