#!/bin/sh
# Runs the API and the web server; if either exits, the container stops and the platform restarts it.
set -e
# Optional, for self-hosting and local trials (the Cloudflare workflow migrates from CI instead).
if [ "$RUN_MIGRATIONS" = "true" ]; then node /app/api/dist/db/migrate.cli.js; fi
if [ "$SEED_DEMO" = "true" ]; then RECURRING_SCHEDULER=off node /app/api/dist/db/seed-demo.cli.js; fi
node /app/api/dist/main.js &
API=$!
HOSTNAME=0.0.0.0 PORT=3000 node /app/web/apps/web/server.js &
WEB=$!
trap 'kill $API $WEB 2>/dev/null' TERM INT
while kill -0 $API 2>/dev/null && kill -0 $WEB 2>/dev/null; do sleep 2; done
kill $API $WEB 2>/dev/null || true
exit 1
