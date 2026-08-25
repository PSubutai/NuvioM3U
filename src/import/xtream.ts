import type { ImportEntry } from "./apply.ts";

export interface XtreamConfig {
  baseUrl: string;
  username: string;
  password: string;
  outputFormat?: string | null;
}

interface XtreamUserInfoResponse {
  user_info?: {
    auth?: number;
    status?: string;
    allowed_output_formats?: string[];
  };
}

interface XtreamCategory {
  category_id?: string | number;
  category_name?: string;
}

interface XtreamLiveStream {
  stream_id?: string | number;
  name?: string;
  stream_icon?: string;
  category_id?: string | number;
}

export const DEFAULT_OUTPUT_FORMAT = "ts";
const REQUEST_TIMEOUT_MS = 20_000;

export function normalizeBaseUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (trimmed === "") throw new Error("Xtream server URL is required.");
  return /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
}

export function playerApiUrl(config: XtreamConfig, action?: string): string {
  const url = new URL(`${normalizeBaseUrl(config.baseUrl)}/player_api.php`);
  url.searchParams.set("username", config.username);
  url.searchParams.set("password", config.password);
  if (action) url.searchParams.set("action", action);
  return url.toString();
}

/**
 * The account dictates which container formats it will serve; an explicit
 * choice wins, otherwise take what the server offers.
 */
export function chooseOutputFormat(
  configured: string | null | undefined,
  allowed: string[] | undefined,
): string {
  const wanted = configured?.trim().replace(/^\./, "").toLowerCase();
  const options = (allowed ?? []).map((value) => value.trim().toLowerCase()).filter(Boolean);

  if (wanted && (options.length === 0 || options.includes(wanted))) return wanted;
  return options[0] ?? DEFAULT_OUTPUT_FORMAT;
}

export function buildLiveUrl(
  config: XtreamConfig,
  streamId: string | number,
  format: string,
): string {
  const base = normalizeBaseUrl(config.baseUrl);
  const user = encodeURIComponent(config.username);
  const pass = encodeURIComponent(config.password);
  return `${base}/live/${user}/${pass}/${streamId}.${format}`;
}

export function mapLiveStreams(
  streams: XtreamLiveStream[],
  categories: XtreamCategory[],
  config: XtreamConfig,
  format: string,
): { entries: ImportEntry[]; warnings: string[] } {
  const warnings: string[] = [];
  const categoryNames = new Map<string, string>();

  for (const category of categories) {
    if (category.category_id === undefined || !category.category_name) continue;
    categoryNames.set(String(category.category_id), category.category_name);
  }

  const entries: ImportEntry[] = [];

  for (const stream of streams) {
    if (stream.stream_id === undefined || stream.stream_id === null) {
      warnings.push("Skipped a stream with no stream_id.");
      continue;
    }

    const name = stream.name?.trim();
    if (!name) {
      warnings.push(`Skipped stream ${String(stream.stream_id)} with no name.`);
      continue;
    }

    entries.push({
      key: `x:${String(stream.stream_id)}`,
      name,
      url: buildLiveUrl(config, String(stream.stream_id), format),
      logo: stream.stream_icon?.trim() || null,
      group:
        stream.category_id === undefined
          ? null
          : (categoryNames.get(String(stream.category_id)) ?? null),
    });
  }

  return { entries, warnings };
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

async function getJson<T>(url: string, fetchImpl: FetchLike, what: string): Promise<T> {
  let response: Response;
  try {
    response = await fetchImpl(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch (error) {
    throw new Error(`Could not reach the Xtream server while fetching ${what}: ${String(error)}`, {
      cause: error,
    });
  }

  if (!response.ok) {
    throw new Error(`Xtream server returned ${response.status} while fetching ${what}.`);
  }

  try {
    return (await response.json()) as T;
  } catch {
    throw new Error(
      `Xtream server did not return JSON for ${what}. Check the server URL and port.`,
    );
  }
}

export interface XtreamSyncResult {
  entries: ImportEntry[];
  warnings: string[];
  format: string;
}

export async function fetchXtreamChannels(
  config: XtreamConfig,
  fetchImpl: FetchLike = fetch,
): Promise<XtreamSyncResult> {
  const info = await getJson<XtreamUserInfoResponse>(
    playerApiUrl(config),
    fetchImpl,
    "account info",
  );

  if (info.user_info?.auth === 0) {
    throw new Error("Xtream server rejected these credentials.");
  }
  if (info.user_info?.status && info.user_info.status.toLowerCase() !== "active") {
    throw new Error(`Xtream account is ${info.user_info.status}.`);
  }

  const format = chooseOutputFormat(
    config.outputFormat,
    info.user_info?.allowed_output_formats,
  );

  const categories = await getJson<XtreamCategory[]>(
    playerApiUrl(config, "get_live_categories"),
    fetchImpl,
    "categories",
  );
  const streams = await getJson<XtreamLiveStream[]>(
    playerApiUrl(config, "get_live_streams"),
    fetchImpl,
    "live streams",
  );

  if (!Array.isArray(streams)) {
    throw new Error("Xtream server returned an unexpected shape for live streams.");
  }

  const mapped = mapLiveStreams(streams, Array.isArray(categories) ? categories : [], config, format);
  return { ...mapped, format };
}
