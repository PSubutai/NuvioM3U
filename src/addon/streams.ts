import type { ChannelWithSources, Source } from "../db/repo.ts";

export interface StremioStream {
  url: string;
  name: string;
  description: string;
  behaviorHints: {
    notWebReady: boolean;
  };
}

const DEAD_MARKER = "⚠ ";

/**
 * Stremio's web player refuses mixed content, so anything that is not HTTPS is
 * flagged so the client hands it to a native player instead.
 */
export function isNotWebReady(url: string): boolean {
  return !url.trim().toLowerCase().startsWith("https://");
}

/**
 * THE single place a Stream object is constructed. A future stream proxy would
 * change this function and nothing else.
 */
export function buildStream(
  source: Source,
  channelName: string,
  addonLabel: string,
): StremioStream {
  const parts = [channelName];
  if (source.label && source.label.trim() !== "") parts.push(source.label.trim());

  const description = (source.health_status === "dead" ? DEAD_MARKER : "") + parts.join(" — ");

  return {
    url: source.url,
    name: addonLabel,
    description,
    behaviorHints: { notWebReady: isNotWebReady(source.url) },
  };
}

/**
 * Flattens channels into a stream list. Dead sources are pushed to the bottom
 * rather than hidden, because a failed probe can be a false negative.
 */
export function buildStreams(
  channels: ChannelWithSources[],
  addonLabel: string,
): StremioStream[] {
  const entries: { stream: StremioStream; dead: boolean }[] = [];

  for (const channel of channels) {
    if (channel.enabled === 0) continue;
    for (const source of channel.sources) {
      entries.push({
        stream: buildStream(source, channel.name, addonLabel),
        dead: source.health_status === "dead",
      });
    }
  }

  return entries
    .map((entry, index) => ({ ...entry, index }))
    .sort((a, b) => Number(a.dead) - Number(b.dead) || a.index - b.index)
    .map((entry) => entry.stream);
}
