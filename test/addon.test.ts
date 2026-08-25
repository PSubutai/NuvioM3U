import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import request from "supertest";
import type { Db } from "../src/db/index.ts";
import { createChannel, createSource, listChannels } from "../src/db/repo.ts";
import { seedList, testApp, testDb } from "./helpers.ts";
import { bundleMetaId, channelMetaId } from "../src/addon/ids.ts";

let db: Db;

beforeEach(() => {
  db = testDb();
});

describe("manifest", () => {
  it("serves every protocol-required field", async () => {
    const list = seedList(db, { name: "My Stream #01" });
    const res = await request(testApp(db)).get(`/s/${list.slug}/manifest.json`);

    expect(res.status).toBe(200);
    for (const field of [
      "id",
      "name",
      "description",
      "version",
      "resources",
      "types",
      "catalogs",
    ]) {
      expect(res.body[field], `missing ${field}`).toBeDefined();
    }

    expect(res.body.name).toBe("My Stream #01");
    expect(res.body.types).toEqual(["tv"]);
    expect(res.body.resources).toEqual(["catalog", "meta", "stream"]);
    expect(res.body.idPrefixes).toEqual([`m3u:${list.slug}:`]);
  });

  it("reports the version from package.json", async () => {
    // Clients treat the manifest version as the signal to refresh a cached
    // addon, so a stale version here means an update that silently does
    // nothing. Keeping one source of truth is what stops that drifting.
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
      version: string;
    };
    const list = seedList(db, { name: "V" });
    const res = await request(testApp(db)).get(`/s/${list.slug}/manifest.json`);

    expect(res.body.version).toBe(pkg.version);
    expect(res.body.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("gives each list a distinct addon id", async () => {
    const a = seedList(db, { name: "A" });
    const b = seedList(db, { name: "B" });
    const app = testApp(db);

    const resA = await request(app).get(`/s/${a.slug}/manifest.json`);
    const resB = await request(app).get(`/s/${b.slug}/manifest.json`);

    expect(resA.body.id).not.toBe(resB.body.id);
  });

  it("advertises skip only for paginated channel catalogs", async () => {
    const bundle = seedList(db, { name: "Bundle", display_mode: "bundle" });
    const channels = seedList(db, { name: "Channels", display_mode: "channels" });
    const app = testApp(db);

    const bundleRes = await request(app).get(`/s/${bundle.slug}/manifest.json`);
    const channelsRes = await request(app).get(`/s/${channels.slug}/manifest.json`);

    expect(bundleRes.body.catalogs[0].extra).toBeUndefined();
    expect(channelsRes.body.catalogs[0].extra).toEqual([
      { name: "skip", isRequired: false },
    ]);
  });

  it("404s an unknown slug", async () => {
    const res = await request(testApp(db)).get("/s/abcdefghijklmnopqrst/manifest.json");
    expect(res.status).toBe(404);
  });

  it("404s a malformed slug without touching the database", async () => {
    const res = await request(testApp(db)).get("/s/nope/manifest.json");
    expect(res.status).toBe(404);
  });
});

describe("CORS", () => {
  it("allows all origins on every addon route, manifest included", async () => {
    const list = seedList(db, {
      name: "L",
      channels: [{ name: "One", urls: ["https://x/1.m3u8"] }],
    });
    const app = testApp(db);
    const id = bundleMetaId(list.slug);

    for (const path of [
      `/s/${list.slug}/manifest.json`,
      `/s/${list.slug}/catalog/tv/main.json`,
      `/s/${list.slug}/meta/tv/${id}.json`,
      `/s/${list.slug}/stream/tv/${id}.json`,
    ]) {
      const res = await request(app).get(path);
      expect(res.headers["access-control-allow-origin"], path).toBe("*");
    }
  });
});

describe("catalog - bundle mode", () => {
  it("returns exactly one meta representing the whole list", async () => {
    const list = seedList(db, {
      name: "My Stream #01",
      display_mode: "bundle",
      channels: [
        { name: "One", urls: ["https://x/1"] },
        { name: "Two", urls: ["https://x/2"] },
      ],
    });

    const res = await request(testApp(db)).get(`/s/${list.slug}/catalog/tv/main.json`);

    expect(res.status).toBe(200);
    expect(res.body.metas).toHaveLength(1);
    expect(res.body.metas[0].id).toBe(bundleMetaId(list.slug));
    expect(res.body.metas[0].name).toBe("My Stream #01");
    expect(res.body.metas[0].type).toBe("tv");
  });

  it("returns nothing past the first page", async () => {
    const list = seedList(db, { name: "L", display_mode: "bundle" });
    const res = await request(testApp(db)).get(
      `/s/${list.slug}/catalog/tv/main/skip=100.json`,
    );
    expect(res.body.metas).toEqual([]);
  });
});

describe("catalog - channels mode", () => {
  it("returns one meta per channel", async () => {
    const list = seedList(db, {
      name: "L",
      display_mode: "channels",
      channels: [
        { name: "BBC One", urls: ["https://x/1"], logo: "https://x/bbc.png" },
        { name: "CNN", urls: ["https://x/2"] },
      ],
    });

    const res = await request(testApp(db)).get(`/s/${list.slug}/catalog/tv/main.json`);

    expect(res.body.metas).toHaveLength(2);
    expect(res.body.metas.map((m: { name: string }) => m.name)).toEqual(["BBC One", "CNN"]);
    expect(res.body.metas[0].poster).toBe("https://x/bbc.png");
  });

  it("omits disabled channels", async () => {
    const list = seedList(db, {
      name: "L",
      display_mode: "channels",
      channels: [
        { name: "Visible", urls: ["https://x/1"] },
        { name: "Hidden", urls: ["https://x/2"], enabled: false },
      ],
    });

    const res = await request(testApp(db)).get(`/s/${list.slug}/catalog/tv/main.json`);
    expect(res.body.metas.map((m: { name: string }) => m.name)).toEqual(["Visible"]);
  });

  it("pages at 100 and signals the end of the catalog", async () => {
    const list = seedList(db, { name: "L", display_mode: "channels" });
    for (let i = 0; i < 250; i++) {
      const channel = createChannel(db, { list_id: list.id, name: `Ch ${i}` });
      createSource(db, { channel_id: channel.id, url: `https://x/${i}` });
    }
    const app = testApp(db);

    const first = await request(app).get(`/s/${list.slug}/catalog/tv/main.json`);
    const second = await request(app).get(`/s/${list.slug}/catalog/tv/main/skip=100.json`);
    const third = await request(app).get(`/s/${list.slug}/catalog/tv/main/skip=200.json`);

    expect(first.body.metas).toHaveLength(100);
    expect(second.body.metas).toHaveLength(100);
    // Fewer than a full page is how Stremio detects the end.
    expect(third.body.metas).toHaveLength(50);

    expect(first.body.metas[0].name).toBe("Ch 0");
    expect(second.body.metas[0].name).toBe("Ch 100");
  });

  it("404s an unknown catalog id", async () => {
    const list = seedList(db, { name: "L" });
    const res = await request(testApp(db)).get(`/s/${list.slug}/catalog/tv/bogus.json`);
    expect(res.status).toBe(404);
  });
});

describe("meta", () => {
  it("opens the detail page straight onto the stream list", async () => {
    const list = seedList(db, {
      name: "L",
      channels: [{ name: "One", urls: ["https://x/1"] }],
    });
    const id = bundleMetaId(list.slug);

    const res = await request(testApp(db)).get(`/s/${list.slug}/meta/tv/${id}.json`);

    expect(res.status).toBe(200);
    expect(res.body.meta.id).toBe(id);
    expect(res.body.meta.behaviorHints.defaultVideoId).toBe(id);
  });

  it("404s a channel that belongs to another list", async () => {
    const a = seedList(db, {
      name: "A",
      display_mode: "channels",
      channels: [{ name: "Secret", urls: ["https://x/secret"] }],
    });
    const b = seedList(db, { name: "B", display_mode: "channels" });

    const channelId = listChannels(db, a.id)[0]!.id;
    const foreignId = channelMetaId(b.slug, channelId);

    const res = await request(testApp(db)).get(`/s/${b.slug}/meta/tv/${foreignId}.json`);
    expect(res.status).toBe(404);
  });
});

describe("stream", () => {
  it("flattens every channel into the bundle's stream list", async () => {
    const list = seedList(db, {
      name: "My Stream #01",
      display_mode: "bundle",
      channels: [
        { name: "BBC One", urls: [{ url: "https://x/1", label: "1080p" }] },
        { name: "CNN", urls: ["https://x/2"] },
      ],
    });

    const res = await request(testApp(db)).get(
      `/s/${list.slug}/stream/tv/${bundleMetaId(list.slug)}.json`,
    );

    expect(res.status).toBe(200);
    expect(res.body.streams).toHaveLength(2);
    expect(res.body.streams[0].description).toBe("BBC One — 1080p");
    expect(res.body.streams[0].name).toBe("My Stream #01");
    expect(res.body.streams[1].description).toBe("CNN");
  });

  it("returns only that channel's sources in channels mode", async () => {
    const list = seedList(db, {
      name: "L",
      display_mode: "channels",
      channels: [
        { name: "BBC One", urls: ["https://x/1", { url: "https://x/1b", label: "backup" }] },
        { name: "CNN", urls: ["https://x/2"] },
      ],
    });

    const bbcId = listChannels(db, list.id)[0]!.id;
    const res = await request(testApp(db)).get(
      `/s/${list.slug}/stream/tv/${channelMetaId(list.slug, bbcId)}.json`,
    );

    expect(res.body.streams).toHaveLength(2);
    expect(res.body.streams.map((s: { description: string }) => s.description)).toEqual([
      "BBC One",
      "BBC One — backup",
    ]);
  });

  it("marks non-HTTPS sources as not web ready", async () => {
    const list = seedList(db, {
      name: "L",
      channels: [
        { name: "Plain", urls: ["http://x/1.ts"] },
        { name: "Secure", urls: ["https://x/2.m3u8"] },
      ],
    });

    const res = await request(testApp(db)).get(
      `/s/${list.slug}/stream/tv/${bundleMetaId(list.slug)}.json`,
    );

    expect(res.body.streams[0].behaviorHints.notWebReady).toBe(true);
    expect(res.body.streams[1].behaviorHints.notWebReady).toBe(false);
  });

  it("never leaks one list's streams into another", async () => {
    const a = seedList(db, {
      name: "A",
      display_mode: "channels",
      channels: [{ name: "Secret", urls: ["https://x/secret"] }],
    });
    const b = seedList(db, {
      name: "B",
      display_mode: "channels",
      channels: [{ name: "Public", urls: ["https://x/public"] }],
    });
    const app = testApp(db);

    const secretChannelId = listChannels(db, a.id)[0]!.id;

    // List A's channel id, requested against list B's slug and against A's own
    // id under B's slug. Neither may return A's stream.
    const viaBSlug = await request(app).get(
      `/s/${b.slug}/stream/tv/${channelMetaId(b.slug, secretChannelId)}.json`,
    );
    const viaASlugOnB = await request(app).get(
      `/s/${b.slug}/stream/tv/${channelMetaId(a.slug, secretChannelId)}.json`,
    );

    expect(viaBSlug.body.streams).toEqual([]);
    expect(viaASlugOnB.body.streams).toEqual([]);

    const bundleLeak = await request(app).get(
      `/s/${b.slug}/stream/tv/${bundleMetaId(a.slug)}.json`,
    );
    expect(bundleLeak.body.streams).toEqual([]);
  });

  it("returns an empty list rather than an error for foreign ids", async () => {
    const list = seedList(db, { name: "L" });
    const res = await request(testApp(db)).get(`/s/${list.slug}/stream/tv/tt1234567.json`);

    expect(res.status).toBe(200);
    expect(res.body.streams).toEqual([]);
  });

  it("is not cacheable", async () => {
    const list = seedList(db, { name: "L" });
    const res = await request(testApp(db)).get(
      `/s/${list.slug}/stream/tv/${bundleMetaId(list.slug)}.json`,
    );
    expect(res.headers["cache-control"]).toContain("no-cache");
  });
});
