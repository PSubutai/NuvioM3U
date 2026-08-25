import { describe, expect, it, vi } from "vitest";
import {
  buildLiveUrl,
  chooseOutputFormat,
  fetchXtreamChannels,
  mapLiveStreams,
  normalizeBaseUrl,
  playerApiUrl,
  type XtreamConfig,
} from "../src/import/xtream.ts";

const config: XtreamConfig = {
  baseUrl: "http://iptv.example:8080",
  username: "user",
  password: "pa ss/word",
};

describe("normalizeBaseUrl", () => {
  it("adds a scheme and strips trailing slashes", () => {
    expect(normalizeBaseUrl("iptv.example:8080/")).toBe("http://iptv.example:8080");
    expect(normalizeBaseUrl("https://iptv.example//")).toBe("https://iptv.example");
  });

  it("rejects an empty URL", () => {
    expect(() => normalizeBaseUrl("   ")).toThrow(/required/i);
  });
});

describe("playerApiUrl", () => {
  it("builds the documented player_api endpoint", () => {
    const url = new URL(playerApiUrl(config, "get_live_streams"));
    expect(url.pathname).toBe("/player_api.php");
    expect(url.searchParams.get("username")).toBe("user");
    expect(url.searchParams.get("password")).toBe("pa ss/word");
    expect(url.searchParams.get("action")).toBe("get_live_streams");
  });

  it("omits the action for the account-info call", () => {
    expect(new URL(playerApiUrl(config)).searchParams.has("action")).toBe(false);
  });
});

describe("chooseOutputFormat", () => {
  it("honours an explicit choice the account allows", () => {
    expect(chooseOutputFormat("m3u8", ["ts", "m3u8"])).toBe("m3u8");
  });

  it("falls back to the first allowed format when the choice is not permitted", () => {
    expect(chooseOutputFormat("m3u8", ["ts"])).toBe("ts");
  });

  it("takes the first allowed format when nothing is configured", () => {
    expect(chooseOutputFormat(null, ["m3u8", "ts"])).toBe("m3u8");
  });

  it("defaults to ts when the server says nothing", () => {
    expect(chooseOutputFormat(null, undefined)).toBe("ts");
    expect(chooseOutputFormat(null, [])).toBe("ts");
  });

  it("tolerates a leading dot and odd casing", () => {
    expect(chooseOutputFormat(".M3U8", ["ts", "m3u8"])).toBe("m3u8");
  });
});

describe("buildLiveUrl", () => {
  it("uses the documented /live path and escapes credentials", () => {
    expect(buildLiveUrl(config, 1234, "ts")).toBe(
      "http://iptv.example:8080/live/user/pa%20ss%2Fword/1234.ts",
    );
  });
});

describe("mapLiveStreams", () => {
  const categories = [{ category_id: "5", category_name: "News" }];

  it("maps streams to import entries with category names as groups", () => {
    const { entries, warnings } = mapLiveStreams(
      [{ stream_id: 1234, name: "CNN", stream_icon: "https://l/cnn.png", category_id: "5" }],
      categories,
      config,
      "ts",
    );

    expect(warnings).toEqual([]);
    expect(entries).toEqual([
      {
        key: "x:1234",
        name: "CNN",
        url: "http://iptv.example:8080/live/user/pa%20ss%2Fword/1234.ts",
        logo: "https://l/cnn.png",
        group: "News",
      },
    ]);
  });

  it("matches categories whether the id is a string or a number", () => {
    const { entries } = mapLiveStreams(
      [{ stream_id: 1, name: "A", category_id: 5 }],
      categories,
      config,
      "ts",
    );
    expect(entries[0]!.group).toBe("News");
  });

  it("skips unusable rows with a warning rather than failing the sync", () => {
    const { entries, warnings } = mapLiveStreams(
      [
        { stream_id: 1, name: "Good" },
        { name: "No id" },
        { stream_id: 3, name: "  " },
      ],
      [],
      config,
      "ts",
    );

    expect(entries).toHaveLength(1);
    expect(warnings).toHaveLength(2);
  });
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("fetchXtreamChannels", () => {
  it("walks account info, categories and streams", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes("get_live_categories")) {
        return jsonResponse([{ category_id: "5", category_name: "News" }]);
      }
      if (url.includes("get_live_streams")) {
        return jsonResponse([{ stream_id: 7, name: "CNN", category_id: "5" }]);
      }
      return jsonResponse({ user_info: { auth: 1, status: "Active", allowed_output_formats: ["m3u8", "ts"] } });
    });

    const result = await fetchXtreamChannels(config, fetchImpl);

    expect(result.format).toBe("m3u8");
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]!.url).toContain("/7.m3u8");
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("reports rejected credentials clearly", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ user_info: { auth: 0 } }));
    await expect(fetchXtreamChannels(config, fetchImpl)).rejects.toThrow(/rejected these credentials/i);
  });

  it("reports a disabled account", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ user_info: { auth: 1, status: "Expired" } }),
    );
    await expect(fetchXtreamChannels(config, fetchImpl)).rejects.toThrow(/Expired/);
  });

  it("explains a non-JSON response instead of crashing", async () => {
    const fetchImpl = vi.fn(async () => new Response("<html>nope</html>", { status: 200 }));
    await expect(fetchXtreamChannels(config, fetchImpl)).rejects.toThrow(/did not return JSON/i);
  });

  it("surfaces an HTTP error", async () => {
    const fetchImpl = vi.fn(async () => new Response("", { status: 502 }));
    await expect(fetchXtreamChannels(config, fetchImpl)).rejects.toThrow(/502/);
  });
});
