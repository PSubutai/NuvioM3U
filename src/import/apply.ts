import type { Db } from "../db/index.ts";
import {
  createChannel,
  createSource,
  findChannelByImportKey,
  listChannels,
  listSources,
  updateChannel,
} from "../db/repo.ts";

export interface ImportEntry {
  /** Identity within the scope, e.g. "tvg:bbc1.uk" or "x:1234". */
  key: string;
  name: string;
  url: string;
  logo?: string | null;
  group?: string | null;
}

export interface ImportSummary {
  channelsAdded: number;
  channelsUpdated: number;
  sourcesAdded: number;
  /** Channels this scope imported before but no longer offers. Never deleted. */
  missing: string[];
  warnings: string[];
}

/**
 * Import scopes keep providers from stepping on each other. Without this, a
 * sync of provider A would report provider B's channels as missing.
 */
export function providerScope(providerId: number): string {
  return `p${providerId}`;
}

export const PASTE_SCOPE = "paste";

function scopedKey(scope: string, key: string): string {
  return `${scope}:${key}`;
}

/**
 * Upserts entries into a list.
 *
 * Entries sharing a key collapse into one channel with several sources, which
 * is exactly the failover shape we want. Channels that vanish upstream are
 * reported but never deleted - an upstream hiccup should not destroy a curated
 * list.
 */
export function applyImport(
  db: Db,
  listId: number,
  scope: string,
  entries: ImportEntry[],
  warnings: string[] = [],
): ImportSummary {
  const summary: ImportSummary = {
    channelsAdded: 0,
    channelsUpdated: 0,
    sourcesAdded: 0,
    missing: [],
    warnings: [...warnings],
  };

  const grouped = new Map<string, ImportEntry[]>();
  for (const entry of entries) {
    const key = scopedKey(scope, entry.key);
    const bucket = grouped.get(key);
    if (bucket) bucket.push(entry);
    else grouped.set(key, [entry]);
  }

  const run = db.transaction(() => {
    for (const [importKey, group] of grouped) {
      const first = group[0]!;
      const existing = findChannelByImportKey(db, listId, importKey);
      const channelId = existing
        ? existing.id
        : createChannel(db, {
            list_id: listId,
            name: first.name,
            logo_url: first.logo ?? null,
            group_title: first.group ?? null,
            import_key: importKey,
          }).id;

      if (existing) {
        updateChannel(db, existing.id, {
          name: first.name,
          logo_url: first.logo ?? existing.logo_url,
          group_title: first.group ?? existing.group_title,
        });
        summary.channelsUpdated++;
      } else {
        summary.channelsAdded++;
      }

      const known = new Set(listSources(db, channelId).map((source) => source.url));
      for (const entry of group) {
        if (known.has(entry.url)) continue;
        createSource(db, { channel_id: channelId, url: entry.url });
        known.add(entry.url);
        summary.sourcesAdded++;
      }
    }

    const prefix = `${scope}:`;
    for (const channel of listChannels(db, listId)) {
      const key = channel.import_key;
      if (key && key.startsWith(prefix) && !grouped.has(key)) {
        summary.missing.push(channel.name);
      }
    }
  });

  run();
  return summary;
}
