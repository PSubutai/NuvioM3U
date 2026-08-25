import { openDatabase, type Db } from "../src/db/index.ts";
import { loadConfig, type AppConfig } from "../src/config.ts";
import { createApp } from "../src/app.ts";
import { createChannel, createList, createSource, type List } from "../src/db/repo.ts";

export function testDb(): Db {
  return openDatabase(":memory:");
}

export function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return { ...loadConfig({ DB_PATH: ":memory:" }), ...overrides };
}

export function testApp(db: Db, config: AppConfig = testConfig()) {
  return createApp(db, config);
}

export interface SeedChannel {
  name: string;
  urls: (string | { url: string; label?: string })[];
  enabled?: boolean;
  logo?: string;
}

/** Creates a list with channels and sources in one call. */
export function seedList(
  db: Db,
  options: {
    name: string;
    display_mode?: "bundle" | "channels";
    channels?: SeedChannel[];
  },
): List {
  const list = createList(db, {
    name: options.name,
    display_mode: options.display_mode ?? "bundle",
  });

  for (const spec of options.channels ?? []) {
    const channel = createChannel(db, {
      list_id: list.id,
      name: spec.name,
      logo_url: spec.logo ?? null,
    });

    if (spec.enabled === false) {
      db.prepare("UPDATE channels SET enabled = 0 WHERE id = ?").run(channel.id);
    }

    for (const entry of spec.urls) {
      const source = typeof entry === "string" ? { url: entry } : entry;
      createSource(db, {
        channel_id: channel.id,
        url: source.url,
        label: source.label ?? null,
      });
    }
  }

  return list;
}
