import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type { Db } from "../src/db/index.ts";
import {
  createProvider,
  getList,
  listChannels,
  listChannelsWithSources,
  listSources,
} from "../src/db/repo.ts";
import { seedList, testApp, testConfig, testDb } from "./helpers.ts";

let db: Db;

beforeEach(() => {
  db = testDb();
});

describe("lists overview", () => {
  it("renders an empty state", async () => {
    const res = await request(testApp(db)).get("/");
    expect(res.status).toBe(200);
    expect(res.text).toContain("No lists yet");
  });

  it("creates a list and redirects to it", async () => {
    const app = testApp(db);
    const res = await request(app)
      .post("/lists")
      .type("form")
      .send({ name: "My Stream #01", display_mode: "bundle" });

    expect(res.status).toBe(303);
    expect(res.headers.location).toMatch(/^\/lists\/\d+/);

    const lists = await request(app).get("/");
    expect(lists.text).toContain("My Stream #01");
  });

  it("rejects a nameless list", async () => {
    const res = await request(testApp(db)).post("/lists").type("form").send({ name: "  " });
    expect(res.headers.location).toContain("err=");
  });
});

describe("install panel", () => {
  it("shows the manifest URL, a stremio link and a QR code", async () => {
    const list = seedList(db, { name: "L" });
    const res = await request(testApp(db)).get(`/lists/${list.id}`);

    expect(res.status).toBe(200);
    expect(res.text).toContain(`/s/${list.slug}/manifest.json`);
    expect(res.text).toContain("stremio://");
    expect(res.text).toContain("<svg");
  });

  it("honours PUBLIC_URL over the request host", async () => {
    const list = seedList(db, { name: "L" });
    const config = testConfig({ publicUrl: "https://m3u.example.com" });
    const res = await request(testApp(db, config)).get(`/lists/${list.id}`);

    expect(res.text).toContain(`https://m3u.example.com/s/${list.slug}/manifest.json`);
    expect(res.text).toContain(`stremio://m3u.example.com/s/${list.slug}/manifest.json`);
  });

  it("derives the URL from X-Forwarded headers behind a proxy", async () => {
    const list = seedList(db, { name: "L" });
    const res = await request(testApp(db))
      .get(`/lists/${list.id}`)
      .set("X-Forwarded-Proto", "https")
      .set("X-Forwarded-Host", "tv.example.com");

    expect(res.text).toContain(`https://tv.example.com/s/${list.slug}/manifest.json`);
  });

  it("rotates the slug and invalidates the old manifest URL", async () => {
    const list = seedList(db, { name: "L" });
    const app = testApp(db);

    const before = await request(app).get(`/s/${list.slug}/manifest.json`);
    expect(before.status).toBe(200);

    await request(app).post(`/lists/${list.id}/rotate-slug`).type("form").send({});

    const after = await request(app).get(`/s/${list.slug}/manifest.json`);
    expect(after.status).toBe(404);

    const rotated = getList(db, list.id)!;
    expect(rotated.slug).not.toBe(list.slug);
    expect((await request(app).get(`/s/${rotated.slug}/manifest.json`)).status).toBe(200);
  });
});

describe("channels", () => {
  it("adds a channel with its first URL", async () => {
    const list = seedList(db, { name: "L" });
    await request(testApp(db))
      .post(`/lists/${list.id}/channels`)
      .type("form")
      .send({ name: "BBC One", url: "https://x/bbc.m3u8" });

    const channels = listChannelsWithSources(db, list.id);
    expect(channels).toHaveLength(1);
    expect(channels[0]!.name).toBe("BBC One");
    expect(channels[0]!.sources[0]!.url).toBe("https://x/bbc.m3u8");
  });

  it("hides and shows a channel", async () => {
    const list = seedList(db, { name: "L", channels: [{ name: "A", urls: ["https://x/1"] }] });
    const channelId = listChannels(db, list.id)[0]!.id;
    const app = testApp(db);

    await request(app).post(`/channels/${channelId}/toggle`).type("form").send({});
    expect(listChannels(db, list.id)[0]!.enabled).toBe(0);

    await request(app).post(`/channels/${channelId}/toggle`).type("form").send({});
    expect(listChannels(db, list.id)[0]!.enabled).toBe(1);
  });

  it("reorders channels", async () => {
    const list = seedList(db, {
      name: "L",
      channels: [
        { name: "First", urls: ["https://x/1"] },
        { name: "Second", urls: ["https://x/2"] },
      ],
    });
    const second = listChannels(db, list.id)[1]!;

    await request(testApp(db))
      .post(`/channels/${second.id}/move`)
      .type("form")
      .send({ direction: "up" });

    expect(listChannels(db, list.id).map((c) => c.name)).toEqual(["Second", "First"]);
  });

  it("does not move the first channel above itself", async () => {
    const list = seedList(db, {
      name: "L",
      channels: [
        { name: "First", urls: ["https://x/1"] },
        { name: "Second", urls: ["https://x/2"] },
      ],
    });
    const first = listChannels(db, list.id)[0]!;

    await request(testApp(db))
      .post(`/channels/${first.id}/move`)
      .type("form")
      .send({ direction: "up" });

    expect(listChannels(db, list.id).map((c) => c.name)).toEqual(["First", "Second"]);
  });

  it("adds a failover URL to an existing channel", async () => {
    const list = seedList(db, { name: "L", channels: [{ name: "A", urls: ["https://x/1"] }] });
    const channelId = listChannels(db, list.id)[0]!.id;

    await request(testApp(db))
      .post(`/channels/${channelId}/sources`)
      .type("form")
      .send({ url: "https://x/backup", label: "backup" });

    const sources = listSources(db, channelId);
    expect(sources).toHaveLength(2);
    expect(sources[1]!.label).toBe("backup");
  });

  it("deletes a channel and its sources", async () => {
    const list = seedList(db, { name: "L", channels: [{ name: "A", urls: ["https://x/1"] }] });
    const channelId = listChannels(db, list.id)[0]!.id;

    await request(testApp(db)).post(`/channels/${channelId}/delete`).type("form").send({});

    expect(listChannels(db, list.id)).toHaveLength(0);
    expect(listSources(db, channelId)).toHaveLength(0);
  });

  it("404s an unknown channel", async () => {
    expect((await request(testApp(db)).get("/channels/9999")).status).toBe(404);
  });
});

describe("channel page", () => {
  it("renders each source with its health and label", async () => {
    const list = seedList(db, {
      name: "L",
      channels: [
        {
          name: "BBC One",
          urls: [
            { url: "https://x/primary.m3u8", label: "1080p" },
            { url: "https://x/backup.m3u8", label: "backup" },
          ],
        },
      ],
    });
    const channelId = listChannels(db, list.id)[0]!.id;

    db.prepare("UPDATE sources SET health_status = 'dead', health_detail = 'HTTP 404' WHERE label = 'backup'").run();

    const res = await request(testApp(db)).get(`/channels/${channelId}`);

    expect(res.status).toBe(200);
    expect(res.text).toContain("https://x/primary.m3u8");
    expect(res.text).toContain("https://x/backup.m3u8");
    expect(res.text).toContain("1080p");
    expect(res.text).toContain("HTTP 404");
    expect(res.text).toContain("dead");
  });
});

describe("providers table", () => {
  it("lists a saved provider with a sync button", async () => {
    const list = seedList(db, { name: "L" });
    createProvider(db, {
      list_id: list.id,
      kind: "xtream",
      url: "http://provider.example:8080",
      username: "someuser",
      password: "secret",
    });

    const res = await request(testApp(db)).get(`/lists/${list.id}`);

    expect(res.text).toContain("http://provider.example:8080");
    expect(res.text).toContain("someuser");
    expect(res.text).toContain("Sync now");
    expect(res.text).toContain("never synced");
    // The password must never reach the page.
    expect(res.text).not.toContain("secret");
  });
});

describe("paste import", () => {
  it("imports a pasted playlist", async () => {
    const list = seedList(db, { name: "L" });
    const res = await request(testApp(db))
      .post(`/lists/${list.id}/import/paste`)
      .type("form")
      .send({
        text: `#EXTM3U
#EXTINF:-1 tvg-logo="https://l/a.png" group-title="News",Channel A
https://x/a.m3u8
#EXTINF:-1,Channel B
https://x/b.m3u8`,
      });

    expect(res.headers.location).toContain("msg=");

    const channels = listChannelsWithSources(db, list.id);
    expect(channels.map((c) => c.name)).toEqual(["Channel A", "Channel B"]);
    expect(channels[0]!.logo_url).toBe("https://l/a.png");
  });

  it("reports input that is not a playlist", async () => {
    const list = seedList(db, { name: "L" });
    const res = await request(testApp(db))
      .post(`/lists/${list.id}/import/paste`)
      .type("form")
      .send({ text: "just some text" });

    expect(res.headers.location).toContain("err=");
    expect(listChannels(db, list.id)).toHaveLength(0);
  });
});

describe("list settings", () => {
  it("saves the display mode and artwork", async () => {
    const list = seedList(db, { name: "L" });

    await request(testApp(db)).post(`/lists/${list.id}`).type("form").send({
      name: "Renamed",
      display_mode: "channels",
      poster_url: "https://x/poster.jpg",
      description: "",
    });

    const updated = getList(db, list.id)!;
    expect(updated.name).toBe("Renamed");
    expect(updated.display_mode).toBe("channels");
    expect(updated.poster_url).toBe("https://x/poster.jpg");
    expect(updated.description).toBeNull();
  });

  it("deletes a list and its channels", async () => {
    const list = seedList(db, { name: "L", channels: [{ name: "A", urls: ["https://x/1"] }] });

    const res = await request(testApp(db)).post(`/lists/${list.id}/delete`).type("form").send({});

    expect(res.headers.location).toContain("/?");
    expect(getList(db, list.id)).toBeUndefined();
    expect(listChannels(db, list.id)).toHaveLength(0);
  });
});

describe("escaping", () => {
  it("escapes list names rather than rendering them as markup", async () => {
    const list = seedList(db, { name: `<script>alert(1)</script>` });
    const res = await request(testApp(db)).get("/");

    expect(res.text).not.toContain("<script>alert(1)</script>");
    expect(res.text).toContain("&lt;script&gt;");
    expect(list.name).toContain("<script>");
  });
});

describe("auth", () => {
  it("is disabled when no password is configured", async () => {
    const res = await request(testApp(db)).get("/");
    expect(res.status).toBe(200);
  });

  it("redirects to the login page when a password is set", async () => {
    const app = testApp(db, testConfig({ adminPassword: "hunter2" }));
    const res = await request(app).get("/");

    expect(res.status).toBe(303);
    expect(res.headers.location).toBe("/login");
  });

  it("lets a correct password through and keeps the session", async () => {
    const app = testApp(db, testConfig({ adminPassword: "hunter2" }));
    const agent = request.agent(app);

    const login = await agent.post("/login").type("form").send({ password: "hunter2" });
    expect(login.status).toBe(303);
    expect(login.headers.location).toBe("/");

    const home = await agent.get("/");
    expect(home.status).toBe(200);
    expect(home.text).toContain("Lists");
  });

  it("rejects a wrong password", async () => {
    const app = testApp(db, testConfig({ adminPassword: "hunter2" }));
    const res = await request(app).post("/login").type("form").send({ password: "nope" });

    expect(res.headers.location).toBe("/login?err=1");
  });

  it("never puts the addon routes behind auth", async () => {
    const list = seedList(db, {
      name: "L",
      channels: [{ name: "A", urls: ["https://x/1"] }],
    });
    const app = testApp(db, testConfig({ adminPassword: "hunter2" }));

    const manifest = await request(app).get(`/s/${list.slug}/manifest.json`);
    const catalog = await request(app).get(`/s/${list.slug}/catalog/tv/main.json`);

    expect(manifest.status).toBe(200);
    expect(catalog.status).toBe(200);
  });
});

describe("healthz", () => {
  it("answers for the container healthcheck", async () => {
    const res = await request(testApp(db)).get("/healthz");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});
