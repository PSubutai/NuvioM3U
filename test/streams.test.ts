import { describe, expect, it } from "vitest";
import { buildStreams, isNotWebReady } from "../src/addon/streams.ts";
import type { ChannelWithSources, HealthStatus, Source } from "../src/db/repo.ts";

function source(overrides: Partial<Source> & { url: string }): Source {
  return {
    id: 1,
    channel_id: 1,
    label: null,
    position: 0,
    health_status: "unknown",
    health_checked_at: null,
    health_detail: null,
    ...overrides,
  };
}

function channel(name: string, sources: Source[], enabled = 1): ChannelWithSources {
  return {
    id: 1,
    list_id: 1,
    name,
    description: null,
    logo_url: null,
    poster_url: null,
    group_title: null,
    import_key: null,
    position: 0,
    enabled,
    sources,
  };
}

describe("isNotWebReady", () => {
  it("flags anything that is not HTTPS", () => {
    expect(isNotWebReady("http://example.com/a.ts")).toBe(true);
    expect(isNotWebReady("rtmp://example.com/live")).toBe(true);
    expect(isNotWebReady("HTTP://example.com/a.ts")).toBe(true);
  });

  it("does not flag HTTPS", () => {
    expect(isNotWebReady("https://example.com/a.m3u8")).toBe(false);
    expect(isNotWebReady("HTTPS://example.com/a.m3u8")).toBe(false);
  });
});

describe("buildStreams", () => {
  it("labels a stream with the list name and the channel name", () => {
    const streams = buildStreams(
      [channel("BBC One", [source({ url: "https://x/1.m3u8" })])],
      "My Stream #01",
    );

    expect(streams).toHaveLength(1);
    expect(streams[0]!.name).toBe("My Stream #01");
    expect(streams[0]!.description).toBe("BBC One");
    expect(streams[0]!.url).toBe("https://x/1.m3u8");
    expect(streams[0]!.behaviorHints.notWebReady).toBe(false);
  });

  it("includes the source label when one is set", () => {
    const streams = buildStreams(
      [channel("BBC One", [source({ url: "https://x/1.m3u8", label: "1080p" })])],
      "List",
    );
    expect(streams[0]!.description).toBe("BBC One — 1080p");
  });

  it("keeps failover sources in their configured order", () => {
    const streams = buildStreams(
      [
        channel("BBC One", [
          source({ id: 1, url: "https://x/primary", label: "primary" }),
          source({ id: 2, url: "https://x/backup", label: "backup" }),
        ]),
      ],
      "List",
    );

    expect(streams.map((s) => s.description)).toEqual([
      "BBC One — primary",
      "BBC One — backup",
    ]);
  });

  it("sorts dead sources last without hiding them", () => {
    const dead: HealthStatus = "dead";
    const streams = buildStreams(
      [
        channel("A", [source({ id: 1, url: "https://x/a", health_status: dead })]),
        channel("B", [source({ id: 2, url: "https://x/b", health_status: "ok" })]),
      ],
      "List",
    );

    expect(streams).toHaveLength(2);
    expect(streams[0]!.description).toBe("B");
    expect(streams[1]!.description).toContain("A");
    expect(streams[1]!.description.startsWith("⚠")).toBe(true);
  });

  it("skips disabled channels", () => {
    const streams = buildStreams(
      [channel("Hidden", [source({ url: "https://x/1" })], 0)],
      "List",
    );
    expect(streams).toEqual([]);
  });
});
