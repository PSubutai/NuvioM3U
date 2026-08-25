import { Router, type Request, type Response, type NextFunction } from "express";
import type { Db } from "../db/index.ts";
import {
  countChannels,
  getChannel,
  getListBySlug,
  listChannels,
  listChannelsWithSources,
  listSources,
  type List,
} from "../db/repo.ts";
import { isValidSlug } from "../util/slug.ts";
import { parseId } from "./ids.ts";
import {
  CATALOG_ID,
  CATALOG_PAGE_SIZE,
  CONTENT_TYPE,
  buildManifest,
  channelMeta,
  channelMetaPreview,
  listMeta,
  listMetaPreview,
  type MetaPreview,
} from "./manifest.ts";
import { buildStreams } from "./streams.ts";

/** The protocol requires CORS allowing all origins on every route. */
function cors(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
  next();
}

/**
 * Strips the `.json` suffix. Done by hand rather than in the route pattern so
 * behaviour does not depend on path-to-regexp version semantics.
 */
function stripJson(value: string | undefined): string | null {
  if (!value || !value.endsWith(".json")) return null;
  const stem = value.slice(0, -".json".length);
  return stem === "" ? null : stem;
}

function parseSkip(extra: string | null): number {
  if (!extra) return 0;
  const raw = new URLSearchParams(extra).get("skip");
  if (raw === null) return 0;
  const skip = Number.parseInt(raw, 10);
  return Number.isFinite(skip) && skip > 0 ? skip : 0;
}

export function createAddonRouter(db: Db): Router {
  const router = Router({ mergeParams: true });

  router.use(cors);
  router.options(/.*/, (_req, res) => {
    res.sendStatus(204);
  });

  /** Resolves :slug to a list, or ends the response with 404. */
  function resolveList(req: Request, res: Response): List | null {
    const slug = (req.params as { slug?: string }).slug;

    if (!slug || !isValidSlug(slug)) {
      res.status(404).json({ err: "not found" });
      return null;
    }

    const list = getListBySlug(db, slug);
    if (!list) {
      res.status(404).json({ err: "not found" });
      return null;
    }

    return list;
  }

  router.get("/manifest.json", (req, res) => {
    const list = resolveList(req, res);
    if (!list) return;

    res.setHeader("Cache-Control", "max-age=60, public");
    res.json(buildManifest(list));
  });

  function handleCatalog(req: Request, res: Response, catalogId: string | null, extra: string | null): void {
    const list = resolveList(req, res);
    if (!list) return;

    if (req.params.type !== CONTENT_TYPE || catalogId !== CATALOG_ID) {
      res.status(404).json({ err: "not found" });
      return;
    }

    const skip = parseSkip(extra);
    let metas: MetaPreview[];

    if (list.display_mode === "bundle") {
      // A bundle is a single poster; anything past the first page is empty.
      metas =
        skip > 0 ? [] : [listMetaPreview(list, countChannels(db, list.id, true))];
    } else {
      const channels = listChannels(db, list.id, {
        enabledOnly: true,
        limit: CATALOG_PAGE_SIZE,
        offset: skip,
      });
      metas = channels.map((channel) => channelMetaPreview(list, channel));
    }

    res.setHeader("Cache-Control", "max-age=60, public");
    res.json({ metas });
  }

  router.get("/catalog/:type/:catalogIdExt", (req, res) => {
    handleCatalog(req, res, stripJson(req.params.catalogIdExt), null);
  });

  router.get("/catalog/:type/:catalogId/:extraExt", (req, res) => {
    handleCatalog(req, res, req.params.catalogId ?? null, stripJson(req.params.extraExt));
  });

  router.get("/meta/:type/:idExt", (req, res) => {
    const list = resolveList(req, res);
    if (!list) return;

    const id = stripJson(req.params.idExt);
    const parsed = id ? parseId(id) : null;

    // Slug scoping is what stops one installed list answering for another.
    if (!parsed || parsed.slug !== list.slug || req.params.type !== CONTENT_TYPE) {
      res.status(404).json({ err: "not found" });
      return;
    }

    res.setHeader("Cache-Control", "max-age=60, public");

    if (parsed.kind === "bundle") {
      res.json({ meta: listMeta(list, listChannelsWithSources(db, list.id, { enabledOnly: true })) });
      return;
    }

    const channel = getChannel(db, parsed.channelId);
    if (!channel || channel.list_id !== list.id) {
      res.status(404).json({ err: "not found" });
      return;
    }

    res.json({ meta: channelMeta(list, channel) });
  });

  router.get("/stream/:type/:idExt", (req, res) => {
    const list = resolveList(req, res);
    if (!list) return;

    const id = stripJson(req.params.idExt);
    const parsed = id ? parseId(id) : null;

    // Live URLs go stale, so never let a client cache the stream list.
    res.setHeader("Cache-Control", "no-cache, max-age=0");

    if (!parsed || parsed.slug !== list.slug || req.params.type !== CONTENT_TYPE) {
      res.json({ streams: [] });
      return;
    }

    if (parsed.kind === "bundle") {
      const channels = listChannelsWithSources(db, list.id, { enabledOnly: true });
      res.json({ streams: buildStreams(channels, list.name) });
      return;
    }

    const channel = getChannel(db, parsed.channelId);
    if (!channel || channel.list_id !== list.id || channel.enabled === 0) {
      res.json({ streams: [] });
      return;
    }

    const withSources = { ...channel, sources: listSources(db, channel.id) };
    res.json({ streams: buildStreams([withSources], list.name) });
  });

  return router;
}
