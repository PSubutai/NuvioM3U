import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../src/db/index.ts";
import { applyImport, PASTE_SCOPE, providerScope } from "../src/import/apply.ts";
import { parseM3u, toImportEntries } from "../src/import/m3u.ts";
import { createList, listChannels, listChannelsWithSources } from "../src/db/repo.ts";
import { testDb } from "./helpers.ts";

let db: Db;

beforeEach(() => {
  db = testDb();
});

const PLAYLIST = `#EXTM3U
#EXTINF:-1 tvg-id="bbc1.uk" tvg-logo="https://l/bbc.png" group-title="UK",BBC One
https://cdn/bbc1.m3u8
#EXTINF:-1 tvg-id="cnn.us" group-title="News",CNN
https://cdn/cnn.m3u8`;

function importPlaylist(listId: number, text: string, scope = PASTE_SCOPE) {
  const parsed = parseM3u(text);
  return applyImport(db, listId, scope, toImportEntries(parsed.entries), parsed.warnings);
}

describe("applyImport", () => {
  it("creates a channel with a source for each entry", () => {
    const list = createList(db, { name: "L" });
    const summary = importPlaylist(list.id, PLAYLIST);

    expect(summary.channelsAdded).toBe(2);
    expect(summary.sourcesAdded).toBe(2);

    const channels = listChannelsWithSources(db, list.id);
    expect(channels.map((c) => c.name)).toEqual(["BBC One", "CNN"]);
    expect(channels[0]!.logo_url).toBe("https://l/bbc.png");
    expect(channels[0]!.group_title).toBe("UK");
    expect(channels[0]!.sources[0]!.url).toBe("https://cdn/bbc1.m3u8");
  });

  it("updates rather than duplicates on re-import", () => {
    const list = createList(db, { name: "L" });
    importPlaylist(list.id, PLAYLIST);
    const second = importPlaylist(list.id, PLAYLIST);

    expect(second.channelsAdded).toBe(0);
    expect(second.channelsUpdated).toBe(2);
    expect(second.sourcesAdded).toBe(0);
    expect(listChannels(db, list.id)).toHaveLength(2);
  });

  it("adds a new URL as a failover source when tvg-id is unchanged", () => {
    const list = createList(db, { name: "L" });
    importPlaylist(list.id, PLAYLIST);

    const moved = PLAYLIST.replace("https://cdn/bbc1.m3u8", "https://cdn2/bbc1.m3u8");
    const summary = importPlaylist(list.id, moved);

    expect(summary.channelsAdded).toBe(0);
    expect(summary.sourcesAdded).toBe(1);

    const bbc = listChannelsWithSources(db, list.id)[0]!;
    expect(bbc.sources.map((s) => s.url)).toEqual([
      "https://cdn/bbc1.m3u8",
      "https://cdn2/bbc1.m3u8",
    ]);
  });

  it("collapses entries sharing a tvg-id into one channel with several sources", () => {
    const list = createList(db, { name: "L" });
    importPlaylist(
      list.id,
      `#EXTM3U
#EXTINF:-1 tvg-id="bbc1.uk",BBC One
https://a/1.m3u8
#EXTINF:-1 tvg-id="bbc1.uk",BBC One Backup
https://b/1.m3u8`,
    );

    const channels = listChannelsWithSources(db, list.id);
    expect(channels).toHaveLength(1);
    expect(channels[0]!.sources.map((s) => s.url)).toEqual([
      "https://a/1.m3u8",
      "https://b/1.m3u8",
    ]);
  });

  it("reports channels that vanished upstream without deleting them", () => {
    const list = createList(db, { name: "L" });
    importPlaylist(list.id, PLAYLIST);

    const shrunk = `#EXTM3U
#EXTINF:-1 tvg-id="bbc1.uk",BBC One
https://cdn/bbc1.m3u8`;
    const summary = importPlaylist(list.id, shrunk);

    expect(summary.missing).toEqual(["CNN"]);
    expect(listChannels(db, list.id)).toHaveLength(2);
  });

  it("does not report another provider's channels as missing", () => {
    const list = createList(db, { name: "L" });
    importPlaylist(list.id, PLAYLIST, providerScope(1));

    const other = `#EXTM3U
#EXTINF:-1 tvg-id="sky.uk",Sky News
https://cdn/sky.m3u8`;
    const summary = importPlaylist(list.id, other, providerScope(2));

    expect(summary.missing).toEqual([]);
    expect(summary.channelsAdded).toBe(1);
    expect(listChannels(db, list.id)).toHaveLength(3);
  });

  it("leaves manually added channels alone", () => {
    const list = createList(db, { name: "L" });
    importPlaylist(list.id, PLAYLIST);

    // A hand-made channel has no import key and must never be reported missing.
    db.prepare("INSERT INTO channels (list_id, name, position) VALUES (?, ?, ?)").run(
      list.id,
      "Manual",
      99,
    );

    const summary = importPlaylist(list.id, PLAYLIST);
    expect(summary.missing).toEqual([]);
  });

  it("carries parser warnings through to the summary", () => {
    const list = createList(db, { name: "L" });
    const summary = importPlaylist(list.id, `#EXTM3U\nhttps://x/stray`);
    expect(summary.warnings).toHaveLength(1);
    expect(summary.channelsAdded).toBe(0);
  });
});
