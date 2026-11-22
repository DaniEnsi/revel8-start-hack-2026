FROM node:20-bookworm-slim AS build

WORKDIR /workspace
RUN corepack enable && corepack prepare pnpm@10.8.0 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/app/package.json apps/app/package.json
COPY packages/database/package.json packages/database/package.json
RUN pnpm install --frozen-lockfile \
    --filter "@x70-monorepo/app..." \
    --filter "@x70-monorepo/database"

COPY . .
ARG NEXT_PUBLIC_CONVEX_URL=http://127.0.0.1:3210
ARG NEXT_PUBLIC_CONVEX_SITE_URL=http://127.0.0.1:3211
ARG NEXT_PUBLIC_REVEL8_SIDECAR=http://localhost:8787
ENV NEXT_PUBLIC_CONVEX_URL=${NEXT_PUBLIC_CONVEX_URL} \
    NEXT_PUBLIC_CONVEX_SITE_URL=${NEXT_PUBLIC_CONVEX_SITE_URL} \
    NEXT_PUBLIC_REVEL8_SIDECAR=${NEXT_PUBLIC_REVEL8_SIDECAR} \
    NEXT_TELEMETRY_DISABLED=1
RUN CI=true pnpm --filter @x70-monorepo/app build

FROM node:20-bookworm-slim AS runtime

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates python3 \
    && update-ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && corepack enable \
    && corepack prepare pnpm@10.8.0 --activate

WORKDIR /workspace
COPY --from=build /workspace /workspace
RUN chmod +x scripts/docker-entrypoint.sh

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    REVEL8_PROJECT_ROOT=/project \
    REVEL8_PYTHON=python3
EXPOSE 3000
CMD ["/workspace/scripts/docker-entrypoint.sh"]
