import type { Db } from "./index.ts";
import { generateSlug } from "../util/slug.ts";

export type DisplayMode = "bundle" | "channels";
export type HealthStatus = "unknown" | "ok" | "dead";
export type ProviderKind = "m3u" | "xtream";

export interface List {
  id: number;
  name: string;
  slug: string;
  display_mode: DisplayMode;
  description: string | null;
  poster_url: string | null;
  background_url: string | null;
  logo_url: string | null;
  position: number;
  created_at: number;
}

export interface Channel {
  id: number;
  list_id: number;
  name: string;
  description: string | null;
  logo_url: string | null;
  poster_url: string | null;
  group_title: string | null;
  import_key: string | null;
  position: number;
  enabled: number;
}

export interface Source {
  id: number;
  channel_id: number;
  label: string | null;
  url: string;
  position: number;
  health_status: HealthStatus;
  health_checked_at: number | null;
  health_detail: string | null;
}

export interface Provider {
  id: number;
  list_id: number;
  kind: ProviderKind;
  url: string;
  username: string | null;
  password: string | null;
  output_format: string | null;
  last_sync_at: number | null;
  last_sync_result: string | null;
}

export interface ChannelWithSources extends Channel {
  sources: Source[];
}

function nextPosition(db: Db, table: "channels" | "sources", column: string, id: number): number {
  const row = db
    .prepare(`SELECT COALESCE(MAX(position), -1) + 1 AS next FROM ${table} WHERE ${column} = ?`)
    .get(id) as { next: number };
  return row.next;
}

/** Builds a partial UPDATE from a whitelist so callers cannot set arbitrary columns. */
function applyPatch<T extends object>(
  db: Db,
  table: string,
  id: number,
  patch: T,
  allowed: readonly (keyof T & string)[],
): void {
  const entries = allowed
    .filter((key) => patch[key] !== undefined)
    .map((key) => [key, patch[key]] as const);

  if (entries.length === 0) return;

  const assignments = entries.map(([key]) => `${key} = ?`).join(", ");
  const values = entries.map(([, value]) => value as never);
  db.prepare(`UPDATE ${table} SET ${assignments} WHERE id = ?`).run(...values, id);
}

/* ---------------------------------------------------------------- lists --- */

export function listLists(db: Db): List[] {
  return db.prepare("SELECT * FROM lists ORDER BY position, id").all() as List[];
}

export function getList(db: Db, id: number): List | undefined {
  return db.prepare("SELECT * FROM lists WHERE id = ?").get(id) as List | undefined;
}

export function getListBySlug(db: Db, slug: string): List | undefined {
  return db.prepare("SELECT * FROM lists WHERE slug = ?").get(slug) as List | undefined;
}

export interface CreateListInput {
  name: string;
  display_mode?: DisplayMode;
  description?: string | null;
}

export function createList(db: Db, input: CreateListInput): List {
  const row = db
    .prepare("SELECT COALESCE(MAX(position), -1) + 1 AS next FROM lists")
    .get() as { next: number };

  const result = db
    .prepare(
      `INSERT INTO lists (name, slug, display_mode, description, position, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.name,
      generateSlug(),
      input.display_mode ?? "bundle",
      input.description ?? null,
      row.next,
      Date.now(),
    );

  return getList(db, Number(result.lastInsertRowid))!;
}

export type UpdateListInput = Partial<
  Pick<
    List,
    | "name"
    | "display_mode"
    | "description"
    | "poster_url"
    | "background_url"
    | "logo_url"
    | "position"
  >
>;

export function updateList(db: Db, id: number, patch: UpdateListInput): void {
  applyPatch(db, "lists", id, patch, [
    "name",
    "display_mode",
    "description",
    "poster_url",
    "background_url",
    "logo_url",
    "position",
  ]);
}

export function deleteList(db: Db, id: number): void {
  db.prepare("DELETE FROM lists WHERE id = ?").run(id);
}

/** Regenerates the list's slug, immediately invalidating the old manifest URL. */
export function rotateListSlug(db: Db, id: number): string {
  const slug = generateSlug();
  db.prepare("UPDATE lists SET slug = ? WHERE id = ?").run(slug, id);
  return slug;
}

/* ------------------------------------------------------------- channels --- */

export function countChannels(db: Db, listId: number, enabledOnly = false): number {
  const sql = enabledOnly
    ? "SELECT COUNT(*) AS total FROM channels WHERE list_id = ? AND enabled = 1"
    : "SELECT COUNT(*) AS total FROM channels WHERE list_id = ?";
  return (db.prepare(sql).get(listId) as { total: number }).total;
}

export interface ChannelQuery {
  enabledOnly?: boolean;
  limit?: number;
  offset?: number;
}

export function listChannels(db: Db, listId: number, query: ChannelQuery = {}): Channel[] {
  const clauses = ["list_id = ?"];
  if (query.enabledOnly) clauses.push("enabled = 1");

  return db
    .prepare(
      `SELECT * FROM channels WHERE ${clauses.join(" AND ")}
       ORDER BY position, id LIMIT ? OFFSET ?`,
    )
    .all(listId, query.limit ?? -1, query.offset ?? 0) as Channel[];
}

export function getChannel(db: Db, id: number): Channel | undefined {
  return db.prepare("SELECT * FROM channels WHERE id = ?").get(id) as Channel | undefined;
}

/** Channels plus their ordered sources, stitched from two queries. */
export function listChannelsWithSources(
  db: Db,
  listId: number,
  query: ChannelQuery = {},
): ChannelWithSources[] {
  const channels = listChannels(db, listId, query);
  if (channels.length === 0) return [];

  const placeholders = channels.map(() => "?").join(", ");
  const sources = db
    .prepare(
      `SELECT * FROM sources WHERE channel_id IN (${placeholders}) ORDER BY position, id`,
    )
    .all(...channels.map((channel) => channel.id)) as Source[];

  const byChannel = new Map<number, Source[]>();
  for (const source of sources) {
    const bucket = byChannel.get(source.channel_id);
    if (bucket) bucket.push(source);
    else byChannel.set(source.channel_id, [source]);
  }

  return channels.map((channel) => ({ ...channel, sources: byChannel.get(channel.id) ?? [] }));
}

export interface CreateChannelInput {
  list_id: number;
  name: string;
  description?: string | null;
  logo_url?: string | null;
  poster_url?: string | null;
  group_title?: string | null;
  import_key?: string | null;
}

export function createChannel(db: Db, input: CreateChannelInput): Channel {
  const result = db
    .prepare(
      `INSERT INTO channels
         (list_id, name, description, logo_url, poster_url, group_title, import_key, position)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.list_id,
      input.name,
      input.description ?? null,
      input.logo_url ?? null,
      input.poster_url ?? null,
      input.group_title ?? null,
      input.import_key ?? null,
      nextPosition(db, "channels", "list_id", input.list_id),
    );

  return getChannel(db, Number(result.lastInsertRowid))!;
}

export type UpdateChannelInput = Partial<
  Pick<
    Channel,
    | "name"
    | "description"
    | "logo_url"
    | "poster_url"
    | "group_title"
    | "import_key"
    | "position"
    | "enabled"
  >
>;

export function updateChannel(db: Db, id: number, patch: UpdateChannelInput): void {
  applyPatch(db, "channels", id, patch, [
    "name",
    "description",
    "logo_url",
    "poster_url",
    "group_title",
    "import_key",
    "position",
    "enabled",
  ]);
}

export function deleteChannel(db: Db, id: number): void {
  db.prepare("DELETE FROM channels WHERE id = ?").run(id);
}

export function findChannelByImportKey(
  db: Db,
  listId: number,
  importKey: string,
): Channel | undefined {
  return db
    .prepare("SELECT * FROM channels WHERE list_id = ? AND import_key = ?")
    .get(listId, importKey) as Channel | undefined;
}

/* -------------------------------------------------------------- sources --- */

export function listSources(db: Db, channelId: number): Source[] {
  return db
    .prepare("SELECT * FROM sources WHERE channel_id = ? ORDER BY position, id")
    .all(channelId) as Source[];
}

export function getSource(db: Db, id: number): Source | undefined {
  return db.prepare("SELECT * FROM sources WHERE id = ?").get(id) as Source | undefined;
}

export function createSource(
  db: Db,
  input: { channel_id: number; url: string; label?: string | null },
): Source {
  const result = db
    .prepare("INSERT INTO sources (channel_id, url, label, position) VALUES (?, ?, ?, ?)")
    .run(
      input.channel_id,
      input.url,
      input.label ?? null,
      nextPosition(db, "sources", "channel_id", input.channel_id),
    );

  return getSource(db, Number(result.lastInsertRowid))!;
}

export type UpdateSourceInput = Partial<
  Pick<Source, "label" | "url" | "position" | "health_status" | "health_checked_at" | "health_detail">
>;

export function updateSource(db: Db, id: number, patch: UpdateSourceInput): void {
  applyPatch(db, "sources", id, patch, [
    "label",
    "url",
    "position",
    "health_status",
    "health_checked_at",
    "health_detail",
  ]);
}

export function deleteSource(db: Db, id: number): void {
  db.prepare("DELETE FROM sources WHERE id = ?").run(id);
}

/** Every source belonging to a list, used by the health prober. */
export function listSourcesForList(db: Db, listId: number): Source[] {
  return db
    .prepare(
      `SELECT s.* FROM sources s
       JOIN channels c ON c.id = s.channel_id
       WHERE c.list_id = ?
       ORDER BY c.position, c.id, s.position, s.id`,
    )
    .all(listId) as Source[];
}

export function listAllSources(db: Db): Source[] {
  return db.prepare("SELECT * FROM sources ORDER BY id").all() as Source[];
}

/* ------------------------------------------------------------ ordering --- */

export type MoveDirection = "up" | "down";

/**
 * Swaps an item with its neighbour. Positions are renumbered first so that
 * imported rows with duplicate or sparse positions still reorder predictably.
 */
function reorder(
  db: Db,
  table: "channels" | "sources",
  parentColumn: string,
  id: number,
  direction: MoveDirection,
): void {
  const move = db.transaction(() => {
    const row = db.prepare(`SELECT ${parentColumn} AS parent FROM ${table} WHERE id = ?`).get(id) as
      | { parent: number }
      | undefined;
    if (!row) return;

    const siblings = db
      .prepare(`SELECT id FROM ${table} WHERE ${parentColumn} = ? ORDER BY position, id`)
      .all(row.parent) as { id: number }[];

    const index = siblings.findIndex((sibling) => sibling.id === id);
    const target = direction === "up" ? index - 1 : index + 1;
    if (index === -1 || target < 0 || target >= siblings.length) return;

    [siblings[index], siblings[target]] = [siblings[target]!, siblings[index]!];

    const update = db.prepare(`UPDATE ${table} SET position = ? WHERE id = ?`);
    siblings.forEach((sibling, position) => update.run(position, sibling.id));
  });

  move();
}

export function moveChannel(db: Db, id: number, direction: MoveDirection): void {
  reorder(db, "channels", "list_id", id, direction);
}

export function moveSource(db: Db, id: number, direction: MoveDirection): void {
  reorder(db, "sources", "channel_id", id, direction);
}

/* ------------------------------------------------------------ providers --- */

export function listProviders(db: Db, listId: number): Provider[] {
  return db
    .prepare("SELECT * FROM providers WHERE list_id = ? ORDER BY id")
    .all(listId) as Provider[];
}

export function getProvider(db: Db, id: number): Provider | undefined {
  return db.prepare("SELECT * FROM providers WHERE id = ?").get(id) as Provider | undefined;
}

export interface CreateProviderInput {
  list_id: number;
  kind: ProviderKind;
  url: string;
  username?: string | null;
  password?: string | null;
  output_format?: string | null;
}

export function createProvider(db: Db, input: CreateProviderInput): Provider {
  const result = db
    .prepare(
      `INSERT INTO providers (list_id, kind, url, username, password, output_format)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.list_id,
      input.kind,
      input.url,
      input.username ?? null,
      input.password ?? null,
      input.output_format ?? null,
    );

  return getProvider(db, Number(result.lastInsertRowid))!;
}

export function recordProviderSync(db: Db, id: number, result: string): void {
  db.prepare("UPDATE providers SET last_sync_at = ?, last_sync_result = ? WHERE id = ?").run(
    Date.now(),
    result,
    id,
  );
}

export function deleteProvider(db: Db, id: number): void {
  db.prepare("DELETE FROM providers WHERE id = ?").run(id);
}
