FROM node:20-alpine

# su-exec: startet den Server am Ende als unprivilegierter Benutzer "node" statt als root.
RUN apk add --no-cache su-exec

WORKDIR /app

# Zuerst nur package.json + package-lock.json kopieren, damit Docker den Installations-
# Schritt cachen kann. "npm ci" installiert exakt die Versionen aus der Lock-Datei
# (reproduzierbar, kein stilles Hochziehen auf neue Versionen bei jedem Rebuild).
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

COPY server.js ./
COPY public ./public
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

ENV DATA_DIR=/app/data
ENV PORT=3000
ENV NODE_ENV=production
VOLUME ["/app/data"]
EXPOSE 3000

# Docker sieht damit, ob die App wirklich antwortet (nicht nur, ob der Prozess läuft).
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -q -O /dev/null "http://127.0.0.1:${PORT}/api/version" || exit 1

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "server.js"]
