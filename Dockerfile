FROM node:20-alpine

WORKDIR /app

# Nur package.json zuerst kopieren, damit Docker den npm-install-Schritt
# cachen kann (schnellere Rebuilds, wenn sich nur der Code ändert).
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY server.js ./
COPY public ./public

ENV DATA_DIR=/app/data
ENV PORT=3000
VOLUME ["/app/data"]
EXPOSE 3000

CMD ["node", "server.js"]
