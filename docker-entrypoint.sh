#!/bin/sh
set -e

# Start Go GraphQL backend in background
docked-graphql &
GO_PID=$!

# Give Go backend a moment to start
sleep 1

# Fail fast: the Go backend is a hard dependency (GraphQL, subscriptions,
# event bridge). Continuing without it only hides the breakage behind
# failing /graphql proxies, and the container would look healthy.
if ! kill -0 $GO_PID 2>/dev/null; then
  echo "FATAL: Go GraphQL backend failed to start" >&2
  exit 1
fi

# Start Node in the background so this shell stays PID 1 and can supervise.
# (exec'ing node would replace the shell and silently defeat the traps.)
node server.js &
NODE_PID=$!

# Forward stop signals to both processes.
trap 'kill $NODE_PID $GO_PID 2>/dev/null; exit' INT TERM

# Watchdog: if the Go backend dies, take Node down too so the container
# exits and the restart policy heals the pair, instead of leaving Node
# running degraded forever.
(
  while kill -0 $GO_PID 2>/dev/null; do sleep 5; done
  echo "FATAL: Go GraphQL backend exited, shutting down Node" >&2
  kill $NODE_PID 2>/dev/null
) &
WATCHDOG_PID=$!

set +e
wait $NODE_PID
STATUS=$?
kill $GO_PID $WATCHDOG_PID 2>/dev/null
exit $STATUS
