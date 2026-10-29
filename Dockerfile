# syntax=docker/dockerfile:1
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund --ignore-scripts=false --legacy-peer-deps

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# build-time placeholders: pages are rendered per-request, but the DB module
# is imported at build time and must not crash on a missing URL
ARG POSTGRES_URL="postgres://build:build@127.0.0.1:5432/build"
ARG AUTH_SECRET="build-time-placeholder"
ARG BASE_URL="http://localhost:3000"
ARG STRIPE_SECRET_KEY="***"
ENV POSTGRES_URL=$POSTGRES_URL AUTH_SECRET=$AUTH_SECRET BASE_URL=$BASE_URL STRIPE_SECRET_KEY=$STRIPE_SECRET_KEY
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/lib/db/migrations ./lib/db/migrations
# Next standalone only traces modules reachable from app code; the migration
# script is a plain node entrypoint, so pull its two deps in explicitly.
COPY --from=deps /app/node_modules/postgres ./node_modules/postgres
COPY --from=deps /app/node_modules/drizzle-orm ./node_modules/drizzle-orm
COPY --from=builder /app/scripts/migrate.mjs ./scripts/migrate.mjs

USER nextjs
EXPOSE 3000
CMD ["sh", "-c", "node scripts/migrate.mjs && node server.js"]
