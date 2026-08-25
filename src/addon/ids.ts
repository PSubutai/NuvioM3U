/**
 * Content ids are scoped to the list's slug.
 *
 * Stremio asks EVERY installed addon whose idPrefixes match a content id. If
 * two of our lists were installed with a shared prefix, list B would be asked
 * for list A's channels. Embedding the slug in both the id and the manifest's
 * idPrefixes makes that structurally impossible.
 */
export const ID_NAMESPACE = "m3u";

export function idPrefixFor(slug: string): string {
  return `${ID_NAMESPACE}:${slug}:`;
}

export function bundleMetaId(slug: string): string {
  return `${idPrefixFor(slug)}l`;
}

export function channelMetaId(slug: string, channelId: number): string {
  return `${idPrefixFor(slug)}c${channelId}`;
}

export type ParsedId =
  | { kind: "bundle"; slug: string }
  | { kind: "channel"; slug: string; channelId: number };

export function parseId(id: string): ParsedId | null {
  const parts = id.split(":");
  if (parts.length !== 3) return null;

  const [namespace, slug, tail] = parts;
  if (namespace !== ID_NAMESPACE || !slug || !tail) return null;

  if (tail === "l") return { kind: "bundle", slug };

  if (tail.startsWith("c")) {
    const digits = tail.slice(1);
    if (!/^\d+$/.test(digits)) return null;
    const channelId = Number.parseInt(digits, 10);
    if (!Number.isSafeInteger(channelId)) return null;
    return { kind: "channel", slug, channelId };
  }

  return null;
}
