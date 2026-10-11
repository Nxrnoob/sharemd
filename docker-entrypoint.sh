#!/bin/sh
# Container entrypoint (runs as root): fix /data ownership for the mounted
# volume, then drop to the non-root `node` user to apply pending drizzle
# migrations (prod-safe, drizzle-orm migrator — no drizzle-kit) and serve.
#
# BROKEN BY DESIGN since the Vercel migration (adapter-vercel emits
# .vercel/output, not build/index.js): this entrypoint now fails fast with
# a clear error instead of a cryptic node crash. Dokploy deploys need either
#   (a) adapter-node back in vite.config.ts (`bun add -d @sveltejs/adapter-node`,
#       remove adapter-vercel, `bun run build` to regenerate build/index.js), or
#   (b) a new Dockerfile that deploys the .vercel/output bundle (not standalone).
# See Dockerfile header for the same note.
set -eu

if [ ! -f /app/build/index.js ]; then
	echo "ERROR: /app/build/index.js is missing." >&2
	echo "  This image was built with @sveltejs/adapter-vercel, which emits" >&2
	echo "  .vercel/output instead of a standalone node server." >&2
	echo "  The Docker/Dokploy flow needs adapter-node (see entrypoint header)." >&2
	exit 1
fi

: "${DATABASE_PATH:=/data/local.db}"
mkdir -p "$(dirname "$DATABASE_PATH")"
chown -R node:node "$(dirname "$DATABASE_PATH")"

runuser -u node -- node /app/scripts/migrate.prod.mjs

exec runuser -u node -- node /app/build/index.js
