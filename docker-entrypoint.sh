#!/bin/sh
# Container entrypoint (runs as root): fix /data ownership for the mounted
# volume, then drop to the non-root `node` user to apply pending drizzle
# migrations (prod-safe, drizzle-orm migrator — no drizzle-kit) and serve.
set -eu

: "${DATABASE_PATH:=/data/local.db}"
mkdir -p "$(dirname "$DATABASE_PATH")"
chown -R node:node "$(dirname "$DATABASE_PATH")"

runuser -u node -- node /app/scripts/migrate.prod.mjs

exec runuser -u node -- node /app/build/index.js
