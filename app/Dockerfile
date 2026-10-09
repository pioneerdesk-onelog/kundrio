# syntax=docker/dockerfile:1.7
# Kundrio – ein Image für App und Worker (amd64 + arm64).
#   App:     docker run … (Standard-Kommando, Next.js standalone auf Port 3000)
#   Worker:  docker run … node --conditions=react-server --import tsx scripts/worker.ts
#            (direkt node, nicht npm: nur so erreicht SIGTERM den Worker für sauberes Herunterfahren)
#   Migrat.: docker run … npx prisma migrate deploy
#
# Worker-Entscheidung: tsx im Image statt Vorab-Bundle. Der Worker lädt Job-Handler dynamisch aus
# src/jobs, nutzt die tsconfig-Pfade (@/…) und die Bedingung react-server (server-only). Ein Bundle
# müsste das alles nachbauen; die einmalige Transpilierzeit beim Start ist vernachlässigbar.

ARG NODE_VERSION=20.20.0

FROM node:${NODE_VERSION}-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# --- Abhängigkeiten (alle, für den Build) ---
FROM base AS deps
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci --no-audit --no-fund

# --- Build ---
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Platzhalter nur für den Build; echte Werte kommen zur Laufzeit. Startprüfung läuft erst beim Serverstart.
ENV NODE_ENV=production SKIP_ENV_CHECK=1 DATABASE_URL="postgresql://build:build@localhost:5432/build" APP_SECRET="build-only-placeholder-not-used-at-runtime"
RUN npx prisma generate && npm run build

# --- Laufzeit-Abhängigkeiten (ohne devDependencies; tsx + prisma sind bewusst dependencies) ---
FROM base AS prod-deps
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci --omit=dev --no-audit --no-fund && npx prisma generate && npm cache clean --force

# --- Laufzeit ---
FROM base AS runtime
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
RUN groupadd --system --gid 1001 crm && useradd --system --uid 1001 --gid crm --home /app crm
# Worker/Migrationen: vollständige Laufzeit-Abhängigkeiten + Quellcode
COPY --from=prod-deps --chown=crm:crm /app/node_modules ./node_modules
COPY --chown=crm:crm package.json package-lock.json tsconfig.json ./
COPY --chown=crm:crm prisma ./prisma
COPY --chown=crm:crm src ./src
COPY --chown=crm:crm scripts ./scripts
# App: Next.js standalone (eigener schlanker Server) + statische Dateien
COPY --from=build --chown=crm:crm /app/.next/standalone ./standalone
COPY --from=build --chown=crm:crm /app/.next/static ./standalone/.next/static
COPY --from=build --chown=crm:crm /app/public ./standalone/public
USER crm
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "standalone/server.js"]
