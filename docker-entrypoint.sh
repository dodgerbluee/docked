#!/bin/sh
set -e

# Phase 8c cutover: the Go binary is the sole server — REST (/api/*),
# GraphQL + WS (/graphql), static SPA, security headers + CORS (EDGE_SERVE).
# It runs its own DB migrations before opening the port (phase 8a), so no
# readiness gate is needed here.
#
# Node is no longer started; its tree stays on disk for rollback until the
# 8d prune. exec keeps Go as PID 1 so stop signals reach it directly.
exec docked-graphql
