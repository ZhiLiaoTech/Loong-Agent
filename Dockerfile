FROM node:24-bookworm-slim

WORKDIR /app

ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages ./packages
COPY scripts ./scripts
COPY README.md ./README.md
COPY docs ./docs

RUN corepack pnpm install --frozen-lockfile
RUN corepack pnpm build

ENV NODE_ENV=production \
    DRAGON_GATEWAY_HOST=0.0.0.0 \
    DRAGON_GATEWAY_PORT=8787 \
    DRAGON_SESSION_DIR=/data/sessions \
    DRAGON_MEMORY_DIR=/data/memory \
    DRAGON_CRON_JOBS=/data/cron/jobs.json

EXPOSE 8787
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD node -e "const port=process.env.DRAGON_GATEWAY_PORT||'8787';const secret=process.env.DRAGON_GATEWAY_SECRET;fetch('http://127.0.0.1:'+port+'/health',{headers:secret?{authorization:'Bearer '+secret}:{}}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "packages/cli/dist/index.js", "gateway"]
