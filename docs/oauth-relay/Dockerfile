# Sauce CRM OAuth relay — small Node 20 LTS image. Multi-stage so the
# runtime image doesn't carry npm cache or build tooling.

FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --no-audit --no-fund

FROM node:20-alpine AS runtime
WORKDIR /app
RUN addgroup -S relay && adduser -S relay -G relay
COPY --from=deps --chown=relay:relay /app/node_modules ./node_modules
COPY --chown=relay:relay src ./src
COPY --chown=relay:relay package.json ./
USER relay
ENV NODE_ENV=production
ENV RELAY_PORT=8787
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8787/health || exit 1
CMD ["node", "src/index.mjs"]
