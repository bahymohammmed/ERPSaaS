#!/bin/sh
# Runs the API and the web server; if either exits, the container stops and the platform restarts it.
set -e
node /app/api/dist/main.js &
API=$!
HOSTNAME=0.0.0.0 PORT=3000 node /app/web/apps/web/server.js &
WEB=$!
trap 'kill $API $WEB 2>/dev/null' TERM INT
while kill -0 $API 2>/dev/null && kill -0 $WEB 2>/dev/null; do sleep 2; done
kill $API $WEB 2>/dev/null || true
exit 1
