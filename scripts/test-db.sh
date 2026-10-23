#!/usr/bin/env bash
# Prepare a throwaway local Postgres DB for migration checks and integration
# tests. Safe to re-run: drops and recreates `forma_test` every time.
#
#   bash scripts/test-db.sh            # fresh DB + migrate + drift check
#
# Exports nothing; integration tests get DATABASE_URL from vitest.config.ts.
set -euo pipefail

URL="postgresql://postgres:postgres@localhost:5432/forma_test"

if ! pg_isready -h localhost -p 5432 >/dev/null 2>&1; then
  service postgresql start >/dev/null
  for _ in $(seq 1 20); do pg_isready -h localhost -p 5432 >/dev/null 2>&1 && break; sleep 0.5; done
fi

su postgres -c "psql -q -c \"ALTER USER postgres PASSWORD 'postgres';\"" >/dev/null
su postgres -c "psql -q -c 'DROP DATABASE IF EXISTS forma_test;' -c 'CREATE DATABASE forma_test;'" >/dev/null

echo "→ applying migrations to fresh forma_test"
DIRECT_URL="$URL" npx prisma migrate deploy

echo "→ checking schema.prisma matches migrations (no drift)"
DIRECT_URL="$URL" npx prisma migrate diff \
  --from-config-datasource --to-schema prisma/schema.prisma --exit-code

echo "✓ test DB ready: $URL"
