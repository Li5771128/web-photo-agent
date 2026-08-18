#!/bin/sh
set -eu

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f /database/init.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())"

for migration in /database/migrations/*.sql; do
  version="${migration##*/}"
  applied="$(psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -Atc "SELECT 1 FROM schema_migrations WHERE version = '$version'")"
  if [ "$applied" != "1" ]; then
    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$migration"
    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "INSERT INTO schema_migrations (version) VALUES ('$version') ON CONFLICT DO NOTHING"
  fi
done
