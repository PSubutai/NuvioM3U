import type { ImportEntry } from "./apply.ts";

export interface M3uEntry {
  name: string;
  url: string;
  tvgId: string | null;
  tvgName: string | null;
  logo: string | null;
  group: string | null;
}

export interface M3uParseResult {
  entries: M3uEntry[];
  warnings: string[];
}

/** Byte-order mark, named rather than inlined so it stays visible in the source. */
const BOM = "﻿";

const ATTRIBUTE_PATTERN = /([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s,]+))/g;

function parseAttributes(input: string): Map<string, string> {
  const attributes = new Map<string, string>();
  for (const match of input.matchAll(ATTRIBUTE_PATTERN)) {
    const value = match[2] ?? match[3] ?? match[4] ?? "";
    attributes.set(match[1]!.toLowerCase(), value.trim());
  }
  return attributes;
}

/**
 * The display title is everything after the first comma that is not inside
 * quotes - attributes such as tvg-name="Foo, Bar" legitimately contain commas.
 */
function splitInfoLine(line: string): { attributes: string; title: string } {
  let quote: string | null = null;

  for (let i = 0; i < line.length; i++) {
    const char = line[i]!;
    if (quote) {
      if (char === quote) quote = null;
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === ",") {
      return { attributes: line.slice(0, i), title: line.slice(i + 1).trim() };
    }
  }

  return { attributes: line, title: "" };
}

function emptyToNull(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/**
 * Tolerant M3U/M3U8 parser. Real-world playlists arrive with BOMs, CRLF, mixed
 * quoting, missing attributes and stray comments, so nothing here is fatal -
 * anything unparseable becomes a warning and the rest of the playlist survives.
 */
export function parseM3u(text: string): M3uParseResult {
  const warnings: string[] = [];
  const entries: M3uEntry[] = [];

  const body = text.startsWith(BOM) ? text.slice(BOM.length) : text;
  const lines = body.split(/\r?\n/);

  let pending: Omit<M3uEntry, "url"> | null = null;
  let pendingGroup: string | null = null;

  for (const [index, rawLine] of lines.entries()) {
    const line = rawLine.trim();
    if (line === "") continue;

    if (line.startsWith("#")) {
      const upper = line.toUpperCase();

      if (upper.startsWith("#EXTINF:")) {
        const { attributes, title } = splitInfoLine(line.slice("#EXTINF:".length));
        const parsed = parseAttributes(attributes);
        const tvgName = emptyToNull(parsed.get("tvg-name"));
        const name = title || tvgName;

        if (!name) {
          warnings.push(`Line ${index + 1}: entry has no name, skipped.`);
          pending = null;
          continue;
        }

        pending = {
          name,
          tvgId: emptyToNull(parsed.get("tvg-id")),
          tvgName,
          logo: emptyToNull(parsed.get("tvg-logo")),
          group: emptyToNull(parsed.get("group-title")),
        };
      } else if (upper.startsWith("#EXTGRP:")) {
        pendingGroup = emptyToNull(line.slice("#EXTGRP:".length));
      }
      // #EXTM3U, #EXTVLCOPT and anything else are not needed here.
      continue;
    }

    if (!pending) {
      warnings.push(`Line ${index + 1}: URL with no preceding #EXTINF, skipped.`);
      continue;
    }

    entries.push({ ...pending, group: pending.group ?? pendingGroup, url: line });
    pending = null;
    pendingGroup = null;
  }

  if (pending) {
    warnings.push(`"${pending.name}" has no URL, skipped.`);
  }

  return { entries, warnings };
}

/**
 * Stable identity for re-import. tvg-id when the playlist provides one,
 * otherwise the URL, so a re-import updates rather than duplicates.
 */
export function importKeyFor(entry: M3uEntry): string {
  return entry.tvgId ? `tvg:${entry.tvgId}` : `url:${entry.url}`;
}

export function toImportEntries(entries: M3uEntry[]): ImportEntry[] {
  return entries.map((entry) => ({
    key: importKeyFor(entry),
    name: entry.name,
    url: entry.url,
    logo: entry.logo,
    group: entry.group,
  }));
}

const PLAYLIST_TIMEOUT_MS = 30_000;
const PLAYLIST_MAX_BYTES = 32 * 1024 * 1024;

/** Downloads a playlist, refusing anything implausibly large. */
export async function fetchPlaylist(
  url: string,
  fetchImpl: (url: string, init?: RequestInit) => Promise<Response> = fetch,
): Promise<string> {
  let response: Response;
  try {
    response = await fetchImpl(url, { signal: AbortSignal.timeout(PLAYLIST_TIMEOUT_MS) });
  } catch (error) {
    throw new Error(`Could not download the playlist: ${String(error)}`);
  }

  if (!response.ok) {
    throw new Error(`Playlist URL returned ${response.status}.`);
  }

  const declared = Number.parseInt(response.headers.get("content-length") ?? "", 10);
  if (Number.isFinite(declared) && declared > PLAYLIST_MAX_BYTES) {
    throw new Error("Playlist is larger than 32 MB.");
  }

  const text = await response.text();
  if (text.length > PLAYLIST_MAX_BYTES) {
    throw new Error("Playlist is larger than 32 MB.");
  }

  return text;
}
