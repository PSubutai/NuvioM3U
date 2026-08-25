import { describe, expect, it } from "vitest";
import { importKeyFor, parseM3u } from "../src/import/m3u.ts";

describe("parseM3u", () => {
  it("parses a well-formed playlist", () => {
    const { entries, warnings } = parseM3u(
      `#EXTM3U
#EXTINF:-1 tvg-id="bbc1.uk" tvg-name="BBC One" tvg-logo="https://l/bbc.png" group-title="UK",BBC One HD
https://cdn.example/bbc1.m3u8
#EXTINF:-1 tvg-id="cnn.us" tvg-logo="https://l/cnn.png" group-title="News",CNN International
http://cdn.example/cnn.ts`,
    );

    expect(warnings).toEqual([]);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toEqual({
      name: "BBC One HD",
      url: "https://cdn.example/bbc1.m3u8",
      tvgId: "bbc1.uk",
      tvgName: "BBC One",
      logo: "https://l/bbc.png",
      group: "UK",
    });
    expect(entries[1]!.name).toBe("CNN International");
    expect(entries[1]!.group).toBe("News");
  });

  it("survives a BOM and CRLF line endings", () => {
    const { entries } = parseM3u(
      "﻿#EXTM3U\r\n#EXTINF:-1,Channel A\r\nhttps://x/a.m3u8\r\n",
    );
    expect(entries).toHaveLength(1);
    expect(entries[0]!.name).toBe("Channel A");
  });

  it("keeps commas that live inside quoted attributes", () => {
    const { entries } = parseM3u(
      `#EXTINF:-1 tvg-name="Sports, Extra" group-title="A, B",Sports Extra HD
https://x/s.m3u8`,
    );
    expect(entries[0]!.name).toBe("Sports Extra HD");
    expect(entries[0]!.tvgName).toBe("Sports, Extra");
    expect(entries[0]!.group).toBe("A, B");
  });

  it("keeps commas in the display title", () => {
    const { entries } = parseM3u(`#EXTINF:-1,Channel, HD\nhttps://x/a`);
    expect(entries[0]!.name).toBe("Channel, HD");
  });

  it("accepts unquoted attribute values", () => {
    const { entries } = parseM3u(`#EXTINF:-1 tvg-id=abc group-title=News,Thing\nhttps://x/a`);
    expect(entries[0]!.tvgId).toBe("abc");
    expect(entries[0]!.group).toBe("News");
  });

  it("falls back to tvg-name when there is no display title", () => {
    const { entries } = parseM3u(`#EXTINF:-1 tvg-name="Fallback Name",\nhttps://x/a`);
    expect(entries[0]!.name).toBe("Fallback Name");
  });

  it("honours #EXTGRP when group-title is absent", () => {
    const { entries } = parseM3u(`#EXTINF:-1,Channel A\n#EXTGRP:Documentaries\nhttps://x/a`);
    expect(entries[0]!.group).toBe("Documentaries");
  });

  it("prefers group-title over #EXTGRP", () => {
    const { entries } = parseM3u(
      `#EXTINF:-1 group-title="Wins",Channel A\n#EXTGRP:Loses\nhttps://x/a`,
    );
    expect(entries[0]!.group).toBe("Wins");
  });

  it("ignores unknown directives such as #EXTVLCOPT", () => {
    const { entries, warnings } = parseM3u(
      `#EXTM3U\n#EXTINF:-1,Channel A\n#EXTVLCOPT:http-user-agent=Mozilla\nhttps://x/a`,
    );
    expect(entries).toHaveLength(1);
    expect(warnings).toEqual([]);
  });

  it("warns instead of throwing on a trailing entry with no URL", () => {
    const { entries, warnings } = parseM3u(`#EXTINF:-1,Orphan`);
    expect(entries).toEqual([]);
    expect(warnings[0]).toContain("Orphan");
  });

  it("warns about a URL with no preceding #EXTINF", () => {
    const { entries, warnings } = parseM3u(`#EXTM3U\nhttps://x/stray`);
    expect(entries).toEqual([]);
    expect(warnings[0]).toContain("no preceding");
  });

  it("returns nothing for empty input", () => {
    expect(parseM3u("").entries).toEqual([]);
    expect(parseM3u("   \n\n  ").entries).toEqual([]);
  });
});

describe("importKeyFor", () => {
  it("prefers tvg-id so a URL change still matches the same channel", () => {
    const base = { name: "A", tvgName: null, logo: null, group: null };
    expect(importKeyFor({ ...base, tvgId: "bbc1.uk", url: "https://x/1" })).toBe("tvg:bbc1.uk");
    expect(importKeyFor({ ...base, tvgId: "bbc1.uk", url: "https://x/2" })).toBe("tvg:bbc1.uk");
  });

  it("falls back to the URL when there is no tvg-id", () => {
    expect(
      importKeyFor({ name: "A", tvgId: null, tvgName: null, logo: null, group: null, url: "https://x/1" }),
    ).toBe("url:https://x/1");
  });
});
