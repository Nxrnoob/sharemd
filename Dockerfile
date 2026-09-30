# ---------- builder: full install (frozen bun lockfile) + SvelteKit build ----------
FROM oven/bun:1 AS builder
WORKDIR /app

# better-sqlite3 native build fallback needs a compiler toolchain
RUN apt-get update \
	&& apt-get install -y --no-install-recommends python3 make g++ \
	&& rm -rf /var/lib/apt/lists/*

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .
RUN bun run build

# ---------- runtime: slim node, prod files only, non-root server ----------
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

RUN mkdir -p /data /app \
	&& chown node:node /data /app

COPY --from=builder --chown=node:node /app/build ./build
COPY --from=builder --chown=node:node /app/drizzle ./drizzle
COPY --from=builder --chown=node:node /app/scripts ./scripts
COPY --from=builder --chown=node:node /app/package.json ./package.json
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

EXPOSE 3000
ENV PORT=3000 HOST=0.0.0.0 DATABASE_PATH=/data/local.db
VOLUME /data

# Root entrypoint fixes /data ownership for the volume, then drops to
# the non-root `node` user for migrations + the server (see entrypoint).
ENTRYPOINT ["/app/docker-entrypoint.sh"]
