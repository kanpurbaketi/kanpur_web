#!/bin/sh
# A local Postgres for development (Homebrew postgresql@17), kept in .pgdata/ and listening on port 5433.
#   sh scripts/devdb.sh        start it (making it the first time)
#   sh scripts/devdb.sh stop   stop it
# Then in .env:  DATABASE_URL=postgres://localhost:5433/kanpur
set -e
PG=${PG:-/opt/homebrew/opt/postgresql@17/bin}
DIR="$(cd "$(dirname "$0")/.." && pwd)/.pgdata"
if [ "$1" = "stop" ]; then "$PG/pg_ctl" -D "$DIR" stop; exit; fi
if [ ! -d "$DIR" ]; then "$PG/initdb" -D "$DIR" -A trust -U "$USER" >/dev/null; fi
"$PG/pg_ctl" -D "$DIR" -o "-p 5433 -k /tmp" -l "$DIR/log" status >/dev/null 2>&1 || "$PG/pg_ctl" -D "$DIR" -o "-p 5433 -k /tmp" -l "$DIR/log" -w start
"$PG/psql" -h localhost -p 5433 -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='kanpur'" | grep -q 1 || "$PG/createdb" -h localhost -p 5433 kanpur
echo "Postgres is up: postgres://localhost:5433/kanpur"
