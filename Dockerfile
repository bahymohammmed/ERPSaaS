# Production image: the NestJS API (port 4000, internal) and the Next.js web app (port 3000, public)
# in one container. The web app proxies /api to the API, so the auth cookie stays same-origin.

FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN corepack enable
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api
COPY apps/web apps/web
RUN pnpm --filter @erp/shared build \
 && pnpm --filter @erp/api build \
 && NEXT_OUTPUT=standalone API_URL=http://127.0.0.1:4000 pnpm --filter @erp/web build \
 && pnpm --filter @erp/api deploy --prod --legacy /out/api

FROM node:22-bookworm-slim
# Chromium renders the PDF reports; the Arabic font is embedded by the API.
RUN apt-get update \
 && apt-get install -y --no-install-recommends chromium tini ca-certificates \
 && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production \
    CHROMIUM_PATH=/usr/bin/chromium \
    PORT=4000 \
    STORAGE_DIR=/data/storage
WORKDIR /app
COPY --from=build /out/api api
COPY --from=build /app/apps/web/.next/standalone web
COPY --from=build /app/apps/web/.next/static web/apps/web/.next/static
COPY deploy/start.sh /app/start.sh
RUN mkdir -p /data/storage && chown -R node:node /data && chmod +x /app/start.sh
USER node
EXPOSE 3000
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["/app/start.sh"]
