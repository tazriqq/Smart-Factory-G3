#!/bin/sh
# Runs schema.sql with the passwords from .env. The database image runs this by itself on the very first start;
# after editing schema.sql run it again:  docker compose exec timescaledb sh /docker-entrypoint-initdb.d/init.sh
set -e
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v db="$POSTGRES_DB" -v telegraf_pass="$PG_TELEGRAF_PASS" -v reader_pass="$PG_READER_PASS" \
  -f /factory/schema.sql
