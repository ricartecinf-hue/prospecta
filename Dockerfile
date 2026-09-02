FROM node:22-bookworm-slim AS builder

ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    NEXT_TELEMETRY_DISABLED=1

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
LABEL org.opencontainers.image.title="Prospecta"
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/src ./src
COPY --from=builder /app/next.config.ts /app/tsconfig.json ./
COPY --from=builder /app/schema.sql ./schema.sql
COPY --from=builder /app/migrations ./migrations

FROM runtime AS prospecta-web
EXPOSE 3000
CMD ["npm", "start"]

FROM runtime AS prospecta-jobs
CMD ["npm", "run", "jobs:start"]
