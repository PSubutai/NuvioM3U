import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "../src/db/index.ts";
import { probeList, probeUrl } from "../src/health/prober.ts";
import { buildStreams } from "../src/addon/streams.ts";
import { listChannelsWithSources } from "../src/db/repo.ts";
import { seedList, testDb } from "./helpers.ts";

let db: Db;

beforeEach(() => {
  db = testDb();
});

describe("probeUrl", () => {
  it("accepts a 206 partial response", async () => {
    const fetchImpl = vi.fn(
      async (_url: string, _init?: RequestInit) => new Response("", { status: 206 }),
    );
    const result = await probeUrl("https://x/a.ts", fetchImpl);

    expect(result.status).toBe("ok");
    expect(fetchImpl.mock.calls[0]![1]?.headers).toMatchObject({ Range: "bytes=0-1" });
  });

  it("marks an HTTP error as dead", async () => {
    const fetchImpl = vi.fn(async () => new Response("", { status: 404 }));
    expect((await probeUrl("https://x/a.ts", fetchImpl)).status).toBe("dead");
  });

  it("marks a network failure as dead", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("getaddrinfo ENOTFOUND x");
    });
    const result = await probeUrl("https://x/a.ts", fetchImpl);

    expect(result.status).toBe("dead");
    expect(result.detail).toContain("ENOTFOUND");
  });

  it("requires an HLS URL to actually return a playlist", async () => {
    const good = vi.fn(async () => new Response("#EXTM3U\n#EXT-X-VERSION:3", { status: 200 }));
    const bad = vi.fn(async () => new Response("<html>login</html>", { status: 200 }));

    expect((await probeUrl("https://x/a.m3u8", good)).status).toBe("ok");
    expect((await probeUrl("https://x/a.m3u8", bad)).status).toBe("dead");
  });

  it("requests enough bytes to actually see the HLS signature", async () => {
    // A server that honours Range exactly. Asking for two bytes would yield
    // "#E", which can never match #EXTM3U - the playlist would be condemned as
    // dead even though it is fine. Caught against a live stream in Docker.
    const playlist = "#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:10\n";
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const header = (init?.headers as Record<string, string> | undefined)?.Range ?? "";
      const end = Number.parseInt(header.replace("bytes=0-", ""), 10);
      const body = Number.isFinite(end) ? playlist.slice(0, end + 1) : playlist;
      return new Response(body, { status: 206 });
    });

    const result = await probeUrl("https://x/live.m3u8", fetchImpl);

    expect(result.status).toBe("ok");
    const headers = fetchImpl.mock.calls[0]![1]?.headers as Record<string, string>;
    const range = headers.Range ?? "";
    expect(range).toMatch(/^bytes=0-\d+$/);
    expect(Number.parseInt(range.slice("bytes=0-".length), 10)).toBeGreaterThanOrEqual(
      "#EXTM3U".length,
    );
  });

  it("still asks for only two bytes of continuous media", async () => {
    const fetchImpl = vi.fn(
      async (_url: string, _init?: RequestInit) => new Response("", { status: 206 }),
    );
    await probeUrl("https://x/live.ts", fetchImpl);

    expect(fetchImpl.mock.calls[0]![1]?.headers).toMatchObject({ Range: "bytes=0-1" });
  });

  it("reports unknown, not dead, for protocols it cannot speak", async () => {
    const fetchImpl = vi.fn();
    const result = await probeUrl("rtmp://x/live", fetchImpl);

    expect(result.status).toBe("unknown");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("marks an unparseable URL as dead", async () => {
    expect((await probeUrl("not a url", vi.fn())).status).toBe("dead");
  });
});

describe("probeList", () => {
  it("records results and pushes dead sources to the bottom of the stream list", async () => {
    const list = seedList(db, {
      name: "L",
      channels: [
        { name: "Broken", urls: ["https://dead/a.ts"] },
        { name: "Working", urls: ["https://live/b.ts"] },
      ],
    });

    const fetchImpl = vi.fn(async (url: string) =>
      url.includes("dead") ? new Response("", { status: 404 }) : new Response("", { status: 206 }),
    );

    const summary = await probeList(db, list.id, { fetchImpl });

    expect(summary).toMatchObject({ checked: 2, ok: 1, dead: 1 });

    const streams = buildStreams(listChannelsWithSources(db, list.id), list.name);
    expect(streams[0]!.description).toBe("Working");
    expect(streams[1]!.description).toContain("Broken");
  });

  it("probes concurrently without losing any source", async () => {
    const list = seedList(db, {
      name: "L",
      channels: Array.from({ length: 25 }, (_, i) => ({
        name: `Ch ${i}`,
        urls: [`https://x/${i}.ts`],
      })),
    });

    const fetchImpl = vi.fn(async () => new Response("", { status: 200 }));
    const summary = await probeList(db, list.id, { fetchImpl, concurrency: 8 });

    expect(summary.checked).toBe(25);
    expect(summary.ok).toBe(25);
    expect(fetchImpl).toHaveBeenCalledTimes(25);
  });
});
