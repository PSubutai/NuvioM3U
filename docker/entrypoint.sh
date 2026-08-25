#!/bin/sh
set -e

# Unraid convention: run as an arbitrary uid/gid so files on the array stay
# owned by the user rather than by root.
PUID="${PUID:-99}"
PGID="${PGID:-100}"

DB_DIR="$(dirname "${DB_PATH:-/config/nuviom3u.db}")"
mkdir -p "$DB_DIR"

if [ "$(id -u)" = "0" ]; then
  if ! getent group nuvio >/dev/null 2>&1; then
    groupadd -o -g "$PGID" nuvio
  fi
  if ! getent passwd nuvio >/dev/null 2>&1; then
    useradd -o -u "$PUID" -g "$PGID" -d /app -s /sbin/nologin nuvio
  fi

  chown -R "$PUID:$PGID" "$DB_DIR"
  echo "Starting NuvioM3U as ${PUID}:${PGID}"
  exec gosu "$PUID:$PGID" "$@"
fi

# Already running unprivileged (e.g. docker run --user).
exec "$@"
