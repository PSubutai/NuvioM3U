import type { Db } from "../db/index.ts";
import { listAllSources, listSourcesForList, updateSource, type Source } from "../db/repo.ts";

export type ProbeStatus = "ok" | "dead" | "unknown";

export interface ProbeResult {
  status: ProbeStatus;
  detail: string;
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

const PROBE_TIMEOUT_MS = 8_000;
const DEFAULT_CONCURRENCY = 8;
const HLS_SNIPPET_BYTES = 4096;

function isHls(url: string): boolean {
  try {
    return new URL(url).pathname.toLowerCase().endsWith(".m3u8");
  } catch {
    return url.toLowerCase().includes(".m3u8");
  }
}

/**
 * Probes one source.
 *
 * Anything we cannot speak over HTTP (rtmp, rtsp, udp) reports "unknown" rather
 * than "dead" - we have no evidence either way and must not condemn a working
 * stream.
 */
export async function probeUrl(
  url: string,
  fetchImpl: FetchLike = fetch,
  timeoutMs = PROBE_TIMEOUT_MS,
): Promise<ProbeResult> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { status: "dead", detail: "Not a valid URL." };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { status: "unknown", detail: `Cannot probe ${parsed.protocol} URLs.` };
  }

  // A playlist has to be read far enough to see its #EXTM3U signature, so it
  // needs a real range. For continuous media two bytes is enough to prove the
  // server answers, and asking for more would start pulling a live stream.
  const hls = isHls(url);
  const range = hls ? `bytes=0-${HLS_SNIPPET_BYTES - 1}` : "bytes=0-1";

  let response: Response;
  try {
    response = await fetchImpl(url, {
      headers: { Range: range, "User-Agent": "NuvioM3U/1.0" },
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { status: "dead", detail: message.slice(0, 200) };
  }

  try {
    if (!response.ok && response.status !== 206) {
      return { status: "dead", detail: `HTTP ${response.status}` };
    }

    if (hls) {
      const text = (await response.text()).slice(0, HLS_SNIPPET_BYTES);
      if (!text.trimStart().startsWith("#EXTM3U")) {
        return { status: "dead", detail: "Response was not an HLS playlist." };
      }
      return { status: "ok", detail: `HTTP ${response.status}, valid HLS playlist` };
    }

    return { status: "ok", detail: `HTTP ${response.status}` };
  } finally {
    // Never leave a live stream downloading in the background.
    try {
      await response.body?.cancel();
    } catch {
      /* body already consumed or closed */
    }
  }
}

async function runPool<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const item = items[cursor++]!;
      await worker(item);
    }
  });
  await Promise.all(runners);
}

export interface ProbeRunSummary {
  checked: number;
  ok: number;
  dead: number;
  unknown: number;
}

export async function probeSources(
  db: Db,
  sources: Source[],
  options: { fetchImpl?: FetchLike; concurrency?: number } = {},
): Promise<ProbeRunSummary> {
  const summary: ProbeRunSummary = { checked: 0, ok: 0, dead: 0, unknown: 0 };

  await runPool(sources, options.concurrency ?? DEFAULT_CONCURRENCY, async (source) => {
    const result = await probeUrl(source.url, options.fetchImpl ?? fetch);

    updateSource(db, source.id, {
      health_status: result.status,
      health_checked_at: Date.now(),
      health_detail: result.detail,
    });

    summary.checked++;
    summary[result.status]++;
  });

  return summary;
}

export function probeList(
  db: Db,
  listId: number,
  options: { fetchImpl?: FetchLike; concurrency?: number } = {},
): Promise<ProbeRunSummary> {
  return probeSources(db, listSourcesForList(db, listId), options);
}

export function probeEverything(
  db: Db,
  options: { fetchImpl?: FetchLike; concurrency?: number } = {},
): Promise<ProbeRunSummary> {
  return probeSources(db, listAllSources(db), options);
}
