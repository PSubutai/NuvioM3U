/**
 * Sequential migrations. Applied in order; `PRAGMA user_version` records how
 * many have run. Never edit an existing entry once it has shipped - append.
 */
export const MIGRATIONS: string[] = [
  `
  CREATE TABLE lists (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    name           TEXT    NOT NULL,
    slug           TEXT    NOT NULL UNIQUE,
    display_mode   TEXT    NOT NULL DEFAULT 'bundle'
                           CHECK (display_mode IN ('bundle', 'channels')),
    description    TEXT,
    poster_url     TEXT,
    background_url TEXT,
    logo_url       TEXT,
    position       INTEGER NOT NULL DEFAULT 0,
    created_at     INTEGER NOT NULL
  );

  CREATE TABLE channels (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    list_id     INTEGER NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
    name        TEXT    NOT NULL,
    description TEXT,
    logo_url    TEXT,
    poster_url  TEXT,
    group_title TEXT,
    import_key  TEXT,
    position    INTEGER NOT NULL DEFAULT 0,
    enabled     INTEGER NOT NULL DEFAULT 1
  );

  CREATE INDEX idx_channels_list ON channels(list_id, position, id);
  CREATE UNIQUE INDEX idx_channels_import_key ON channels(list_id, import_key)
    WHERE import_key IS NOT NULL;

  CREATE TABLE sources (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    channel_id        INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    label             TEXT,
    url               TEXT    NOT NULL,
    position          INTEGER NOT NULL DEFAULT 0,
    health_status     TEXT    NOT NULL DEFAULT 'unknown'
                              CHECK (health_status IN ('unknown', 'ok', 'dead')),
    health_checked_at INTEGER,
    health_detail     TEXT
  );

  CREATE INDEX idx_sources_channel ON sources(channel_id, position, id);

  CREATE TABLE providers (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    list_id          INTEGER NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
    kind             TEXT    NOT NULL CHECK (kind IN ('m3u', 'xtream')),
    url              TEXT    NOT NULL,
    username         TEXT,
    password         TEXT,
    output_format    TEXT,
    last_sync_at     INTEGER,
    last_sync_result TEXT
  );

  CREATE INDEX idx_providers_list ON providers(list_id, id);
  `,
];
