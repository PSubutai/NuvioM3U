import { describe, expect, it } from "vitest";
import { bundleMetaId, channelMetaId, idPrefixFor, parseId } from "../src/addon/ids.ts";
import { generateSlug, isValidSlug } from "../src/util/slug.ts";

describe("slug", () => {
  it("generates URL-safe slugs of a usable length", () => {
    const slug = generateSlug();
    expect(slug).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(slug.length).toBe(20);
    expect(isValidSlug(slug)).toBe(true);
  });

  it("does not repeat", () => {
    const slugs = new Set(Array.from({ length: 500 }, () => generateSlug()));
    expect(slugs.size).toBe(500);
  });

  it("rejects malformed slugs", () => {
    expect(isValidSlug("")).toBe(false);
    expect(isValidSlug("short")).toBe(false);
    expect(isValidSlug("../../etc/passwd")).toBe(false);
    expect(isValidSlug("has spaces in it here")).toBe(false);
  });
});

describe("content ids", () => {
  const slug = "AbCdEf0123456789_-xy";

  it("round-trips a bundle id", () => {
    expect(parseId(bundleMetaId(slug))).toEqual({ kind: "bundle", slug });
  });

  it("round-trips a channel id", () => {
    expect(parseId(channelMetaId(slug, 42))).toEqual({
      kind: "channel",
      slug,
      channelId: 42,
    });
  });

  it("scopes the manifest prefix to the slug", () => {
    expect(idPrefixFor(slug)).toBe(`m3u:${slug}:`);
    expect(bundleMetaId(slug).startsWith(idPrefixFor(slug))).toBe(true);
    expect(channelMetaId(slug, 7).startsWith(idPrefixFor(slug))).toBe(true);
  });

  it("rejects ids that are not ours", () => {
    expect(parseId("tt1234567")).toBeNull();
    expect(parseId("kitsu:anime:1")).toBeNull();
    expect(parseId("m3u:slug")).toBeNull();
    expect(parseId("m3u:slug:x9")).toBeNull();
    expect(parseId("m3u:slug:cNaN")).toBeNull();
    expect(parseId("m3u::l")).toBeNull();
    expect(parseId("")).toBeNull();
  });
});
