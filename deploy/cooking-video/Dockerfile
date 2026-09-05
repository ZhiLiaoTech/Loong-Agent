FROM node:24.8.0-bookworm-slim@sha256:cadbfafeb6baf87eaaffa40b3640209c4b7fd38cebde65059d15bc39cd636b85 AS build

WORKDIR /app
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable && corepack prepare pnpm@10.11.0 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages ./packages
COPY scripts ./scripts
COPY deploy/cooking-video ./deploy/cooking-video
RUN corepack pnpm install --frozen-lockfile
RUN corepack pnpm --filter @loong/cooking-video... build

FROM node:24.8.0-bookworm-slim@sha256:cadbfafeb6baf87eaaffa40b3640209c4b7fd38cebde65059d15bc39cd636b85 AS runtime

ARG DEBIAN_SNAPSHOT=20250911T000000Z
WORKDIR /app
ENV NODE_ENV=production \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    LOONG_COOKING_VIDEO_JOBS_ROOT=/data/jobs \
    CHROME_BIN=/usr/bin/chromium \
    REMOTION_BROWSER_EXECUTABLE=/usr/bin/chromium

RUN sed -Ei "s|https?://deb.debian.org/debian-security|https://snapshot.debian.org/archive/debian-security/${DEBIAN_SNAPSHOT}|g; s|https?://deb.debian.org/debian|https://snapshot.debian.org/archive/debian/${DEBIAN_SNAPSHOT}|g" /etc/apt/sources.list.d/debian.sources \
    && ! grep -Eq 'URIs: https?://(deb|security)\.debian\.org' /etc/apt/sources.list.d/debian.sources \
    && printf 'Acquire::Check-Valid-Until "false";\n' > /etc/apt/apt.conf.d/99snapshot \
    && apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates chromium ffmpeg fonts-dejavu-core fonts-noto-cjk tini \
    && rm -rf /var/lib/apt/lists/*

COPY --from=build /app /app
RUN corepack enable && corepack prepare pnpm@10.11.0 --activate \
    && node deploy/cooking-video/verify-runtime.mjs

RUN groupadd --gid 10001 loong && useradd --uid 10001 --gid loong --create-home loong \
    && mkdir -p /data/jobs && chown -R loong:loong /data
USER 10001:10001
VOLUME ["/data"]

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "packages/cooking-video/dist/worker-cli.js"]
