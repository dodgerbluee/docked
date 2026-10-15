#!/bin/sh
set -e

# Start Go GraphQL backend in background
docked-graphql &
GO_PID=$!

# Give Go backend a moment to start
sleep 1

# Verify Go backend is up
if ! kill -0 $GO_PID 2>/dev/null; then
  echo "WARNING: Go GraphQL backend failed to start, continuing without it"
fi

# Cleanup: kill Go backend when Node exits
trap "kill $GO_PID 2>/dev/null" EXIT

# Start Node server in foreground
exec node server.js
