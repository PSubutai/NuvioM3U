import type { Channel, ChannelWithSources, List } from "../db/repo.ts";
import { ADDON_VERSION } from "../version.ts";
import { bundleMetaId, channelMetaId, idPrefixFor } from "./ids.ts";

export const CATALOG_ID = "main";
export const CONTENT_TYPE = "tv";
/** Stremio pages catalogs 100 at a time; fewer than a full page means the end. */
export const CATALOG_PAGE_SIZE = 100;

export interface Manifest {
  id: string;
  version: string;
  name: string;
  description: string;
  resources: string[];
  types: string[];
  idPrefixes: string[];
  catalogs: {
    type: string;
    id: string;
    name: string;
    extra?: { name: string; isRequired: boolean }[];
  }[];
  logo?: string;
  background?: string;
  behaviorHints: { adult: boolean; p2p: boolean; configurable: boolean };
}

export function buildManifest(list: List): Manifest {
  const isChannels = list.display_mode === "channels";

  const manifest: Manifest = {
    id: `community.nuviom3u.${list.slug}`,
    version: ADDON_VERSION,
    name: list.name,
    description:
      list.description?.trim() ||
      (isChannels
        ? `Live channels from the "${list.name}" list.`
        : `Live streams bundled under "${list.name}".`),
    resources: ["catalog", "meta", "stream"],
    types: [CONTENT_TYPE],
    idPrefixes: [idPrefixFor(list.slug)],
    catalogs: [
      {
        type: CONTENT_TYPE,
        id: CATALOG_ID,
        name: list.name,
        // Only a paginated catalog needs to advertise skip.
        ...(isChannels ? { extra: [{ name: "skip", isRequired: false }] } : {}),
      },
    ],
    behaviorHints: { adult: false, p2p: false, configurable: false },
  };

  if (list.logo_url) manifest.logo = list.logo_url;
  if (list.background_url) manifest.background = list.background_url;

  return manifest;
}

export interface MetaPreview {
  id: string;
  type: string;
  name: string;
  poster?: string;
  posterShape: "square" | "poster" | "landscape";
  logo?: string;
  background?: string;
  description?: string;
}

export interface Meta extends MetaPreview {
  behaviorHints: { defaultVideoId: string };
}

export function listMetaPreview(list: List, channelCount: number): MetaPreview {
  const preview: MetaPreview = {
    id: bundleMetaId(list.slug),
    type: CONTENT_TYPE,
    name: list.name,
    posterShape: "square",
    description:
      list.description?.trim() ||
      `${channelCount} stream${channelCount === 1 ? "" : "s"} in this list.`,
  };

  if (list.poster_url) preview.poster = list.poster_url;
  if (list.logo_url) preview.logo = list.logo_url;
  if (list.background_url) preview.background = list.background_url;

  return preview;
}

export function channelMetaPreview(list: List, channel: Channel): MetaPreview {
  const artwork = channel.poster_url ?? channel.logo_url ?? undefined;

  const preview: MetaPreview = {
    id: channelMetaId(list.slug, channel.id),
    type: CONTENT_TYPE,
    name: channel.name,
    posterShape: "square",
  };

  if (artwork) preview.poster = artwork;
  if (channel.logo_url) preview.logo = channel.logo_url;
  if (channel.description) preview.description = channel.description;
  else if (channel.group_title) preview.description = channel.group_title;

  return preview;
}

/**
 * A meta with no `videos` array is treated by Stremio as having a single video
 * whose id equals the meta id. defaultVideoId states that explicitly so the
 * detail page opens straight onto the stream list.
 */
export function toMeta(preview: MetaPreview): Meta {
  return { ...preview, behaviorHints: { defaultVideoId: preview.id } };
}

export function listMeta(list: List, channels: ChannelWithSources[]): Meta {
  return toMeta(listMetaPreview(list, channels.length));
}

export function channelMeta(list: List, channel: Channel): Meta {
  return toMeta(channelMetaPreview(list, channel));
}
