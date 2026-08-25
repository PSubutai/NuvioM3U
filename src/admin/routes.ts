import express, { Router, type Request, type Response } from "express";
import QRCode from "qrcode";
import type { Db } from "../db/index.ts";
import { resolveBaseUrl, type AppConfig } from "../config.ts";
import {
  countChannels,
  createChannel,
  createList,
  createProvider,
  createSource,
  deleteChannel,
  deleteList,
  deleteProvider,
  deleteSource,
  getChannel,
  getList,
  getProvider,
  getSource,
  listChannelsWithSources,
  listLists,
  listProviders,
  listSources,
  moveChannel,
  moveSource,
  recordProviderSync,
  rotateListSlug,
  updateChannel,
  updateList,
  type List,
  type MoveDirection,
  type Provider,
} from "../db/repo.ts";
import { applyImport, PASTE_SCOPE, providerScope, type ImportSummary } from "../import/apply.ts";
import { fetchPlaylist, parseM3u, toImportEntries } from "../import/m3u.ts";
import { fetchXtreamChannels } from "../import/xtream.ts";
import { probeList } from "../health/prober.ts";
import { layout } from "./html.ts";
import {
  renderChannelPage,
  renderListPage,
  renderListsPage,
  type InstallInfo,
  type ListSummary,
} from "./views.ts";

function trimmed(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function optional(value: unknown): string | null {
  const text = trimmed(value);
  return text === "" ? null : text;
}

/** Flash messages ride on the query string so no session store is needed. */
function redirectWith(res: Response, path: string, flash: { msg?: string; err?: string }): void {
  const params = new URLSearchParams();
  if (flash.msg) params.set("msg", flash.msg);
  if (flash.err) params.set("err", flash.err);
  const query = params.toString();
  res.redirect(303, query ? `${path}?${query}` : path);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function summarise(summary: ImportSummary): string {
  const parts = [
    `${summary.channelsAdded} added`,
    `${summary.channelsUpdated} updated`,
    `${summary.sourcesAdded} new URL${summary.sourcesAdded === 1 ? "" : "s"}`,
  ];
  if (summary.missing.length > 0) {
    parts.push(`${summary.missing.length} no longer offered (kept)`);
  }
  if (summary.warnings.length > 0) {
    parts.push(`${summary.warnings.length} warning${summary.warnings.length === 1 ? "" : "s"}`);
  }
  return parts.join(", ");
}

async function buildInstallInfo(req: Request, config: AppConfig, list: List): Promise<InstallInfo> {
  const base = resolveBaseUrl(
    { protocol: req.protocol, headers: req.headers as Record<string, string | string[] | undefined> },
    config,
  );
  const manifestUrl = `${base}/s/${list.slug}/manifest.json`;

  let qrSvg: string | null = null;
  try {
    qrSvg = await QRCode.toString(manifestUrl, {
      type: "svg",
      margin: 1,
      width: 148,
      errorCorrectionLevel: "M",
    });
  } catch {
    qrSvg = null; // A missing QR must never block the page.
  }

  return {
    manifestUrl,
    stremioUrl: manifestUrl.replace(/^https?:\/\//i, "stremio://"),
    qrSvg,
  };
}

export function createAdminRouter(db: Db, config: AppConfig): Router {
  const router = Router();

  router.use(express.urlencoded({ extended: false, limit: "40mb" }));

  function page(req: Request, res: Response, title: string, body: string, breadcrumb?: string): void {
    res.type("html").send(
      layout({
        title,
        body,
        breadcrumb: breadcrumb ?? null,
        message: optional(req.query.msg),
        error: optional(req.query.err),
      }),
    );
  }

  function numericParam(req: Request, name: string): number | null {
    const raw = (req.params as Record<string, string | undefined>)[name];
    const value = Number.parseInt(raw ?? "", 10);
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  }

  /** Resolves :id to a list, or 404s. */
  function requireList(req: Request, res: Response): List | null {
    const id = numericParam(req, "id");
    const list = id === null ? undefined : getList(db, id);
    if (!list) {
      res.status(404).type("html").send(layout({ title: "Not found", body: "<p>No such list.</p>" }));
      return null;
    }
    return list;
  }

  /* ------------------------------------------------------------- lists --- */

  router.get("/", (req, res) => {
    const lists: ListSummary[] = listLists(db).map((list) => {
      const channels = listChannelsWithSources(db, list.id);
      const deadCount = channels.filter(
        (channel) =>
          channel.sources.length > 0 &&
          channel.sources.every((source) => source.health_status === "dead"),
      ).length;
      return { ...list, channelCount: channels.length, deadCount };
    });

    page(req, res, "NuvioM3U", renderListsPage(lists));
  });

  router.post("/lists", (req, res) => {
    const name = trimmed(req.body?.name);
    if (name === "") {
      redirectWith(res, "/", { err: "A list needs a name." });
      return;
    }

    const mode = trimmed(req.body?.display_mode) === "channels" ? "channels" : "bundle";
    const list = createList(db, { name, display_mode: mode });
    redirectWith(res, `/lists/${list.id}`, { msg: `Created "${list.name}".` });
  });

  router.get("/lists/:id", (req, res) => {
    void (async () => {
      const list = requireList(req, res);
      if (!list) return;

      const body = renderListPage({
        list,
        channels: listChannelsWithSources(db, list.id),
        providers: listProviders(db, list.id),
        install: await buildInstallInfo(req, config, list),
      });

      page(req, res, `${list.name} - NuvioM3U`, body, list.name);
    })();
  });

  router.post("/lists/:id", (req, res) => {
    const list = requireList(req, res);
    if (!list) return;

    const name = trimmed(req.body?.name);
    if (name === "") {
      redirectWith(res, `/lists/${list.id}`, { err: "A list needs a name." });
      return;
    }

    updateList(db, list.id, {
      name,
      display_mode: trimmed(req.body?.display_mode) === "channels" ? "channels" : "bundle",
      description: optional(req.body?.description),
      poster_url: optional(req.body?.poster_url),
      logo_url: optional(req.body?.logo_url),
      background_url: optional(req.body?.background_url),
    });

    redirectWith(res, `/lists/${list.id}`, { msg: "Settings saved." });
  });

  router.post("/lists/:id/delete", (req, res) => {
    const list = requireList(req, res);
    if (!list) return;

    deleteList(db, list.id);
    redirectWith(res, "/", { msg: `Deleted "${list.name}".` });
  });

  router.post("/lists/:id/rotate-slug", (req, res) => {
    const list = requireList(req, res);
    if (!list) return;

    rotateListSlug(db, list.id);
    redirectWith(res, `/lists/${list.id}`, {
      msg: "New URL generated. Re-install this list wherever you use it.",
    });
  });

  /* ---------------------------------------------------------- channels --- */

  router.post("/lists/:id/channels", (req, res) => {
    const list = requireList(req, res);
    if (!list) return;

    const name = trimmed(req.body?.name);
    const url = trimmed(req.body?.url);
    if (name === "" || url === "") {
      redirectWith(res, `/lists/${list.id}`, { err: "A channel needs a name and a URL." });
      return;
    }

    const channel = createChannel(db, { list_id: list.id, name });
    createSource(db, { channel_id: channel.id, url });
    redirectWith(res, `/lists/${list.id}`, { msg: `Added "${name}".` });
  });

  /** Resolves :id to a channel plus its list, or 404s. */
  function requireChannel(req: Request, res: Response) {
    const id = numericParam(req, "id");
    const channel = id === null ? undefined : getChannel(db, id);
    const list = channel ? getList(db, channel.list_id) : undefined;

    if (!channel || !list) {
      res.status(404).type("html").send(layout({ title: "Not found", body: "<p>No such channel.</p>" }));
      return null;
    }
    return { channel, list };
  }

  router.get("/channels/:id", (req, res) => {
    const found = requireChannel(req, res);
    if (!found) return;

    page(
      req,
      res,
      `${found.channel.name} - NuvioM3U`,
      renderChannelPage({
        list: found.list,
        channel: found.channel,
        sources: listSources(db, found.channel.id),
      }),
      `${found.list.name} / ${found.channel.name}`,
    );
  });

  router.post("/channels/:id", (req, res) => {
    const found = requireChannel(req, res);
    if (!found) return;

    const name = trimmed(req.body?.name);
    if (name === "") {
      redirectWith(res, `/channels/${found.channel.id}`, { err: "A channel needs a name." });
      return;
    }

    updateChannel(db, found.channel.id, {
      name,
      description: optional(req.body?.description),
      group_title: optional(req.body?.group_title),
      logo_url: optional(req.body?.logo_url),
      poster_url: optional(req.body?.poster_url),
    });

    redirectWith(res, `/channels/${found.channel.id}`, { msg: "Channel saved." });
  });

  router.post("/channels/:id/delete", (req, res) => {
    const found = requireChannel(req, res);
    if (!found) return;

    deleteChannel(db, found.channel.id);
    redirectWith(res, `/lists/${found.list.id}`, { msg: `Deleted "${found.channel.name}".` });
  });

  router.post("/channels/:id/toggle", (req, res) => {
    const found = requireChannel(req, res);
    if (!found) return;

    const enabled = found.channel.enabled === 1 ? 0 : 1;
    updateChannel(db, found.channel.id, { enabled });
    redirectWith(res, `/lists/${found.list.id}`, {
      msg: enabled === 1 ? `"${found.channel.name}" is visible.` : `"${found.channel.name}" is hidden.`,
    });
  });

  router.post("/channels/:id/move", (req, res) => {
    const found = requireChannel(req, res);
    if (!found) return;

    moveChannel(db, found.channel.id, trimmed(req.body?.direction) === "up" ? "up" : "down");
    res.redirect(303, `/lists/${found.list.id}`);
  });

  /* ----------------------------------------------------------- sources --- */

  router.post("/channels/:id/sources", (req, res) => {
    const found = requireChannel(req, res);
    if (!found) return;

    const url = trimmed(req.body?.url);
    if (url === "") {
      redirectWith(res, `/channels/${found.channel.id}`, { err: "A URL is required." });
      return;
    }

    createSource(db, {
      channel_id: found.channel.id,
      url,
      label: optional(req.body?.label),
    });
    redirectWith(res, `/channels/${found.channel.id}`, { msg: "URL added." });
  });

  function requireSource(req: Request, res: Response) {
    const id = numericParam(req, "id");
    const source = id === null ? undefined : getSource(db, id);
    const channel = source ? getChannel(db, source.channel_id) : undefined;

    if (!source || !channel) {
      res.status(404).type("html").send(layout({ title: "Not found", body: "<p>No such URL.</p>" }));
      return null;
    }
    return { source, channel };
  }

  router.post("/sources/:id/delete", (req, res) => {
    const found = requireSource(req, res);
    if (!found) return;

    deleteSource(db, found.source.id);
    redirectWith(res, `/channels/${found.channel.id}`, { msg: "URL deleted." });
  });

  router.post("/sources/:id/move", (req, res) => {
    const found = requireSource(req, res);
    if (!found) return;

    moveSource(db, found.source.id, (trimmed(req.body?.direction) === "up" ? "up" : "down") as MoveDirection);
    res.redirect(303, `/channels/${found.channel.id}`);
  });

  /* ------------------------------------------------------------ import --- */

  router.post("/lists/:id/import/paste", (req, res) => {
    const list = requireList(req, res);
    if (!list) return;

    const text = typeof req.body?.text === "string" ? req.body.text : "";
    if (text.trim() === "") {
      redirectWith(res, `/lists/${list.id}`, { err: "Nothing to import." });
      return;
    }

    const parsed = parseM3u(text);
    if (parsed.entries.length === 0) {
      redirectWith(res, `/lists/${list.id}`, {
        err: `No channels found. ${parsed.warnings[0] ?? "Is this an M3U playlist?"}`,
      });
      return;
    }

    const summary = applyImport(
      db,
      list.id,
      PASTE_SCOPE,
      toImportEntries(parsed.entries),
      parsed.warnings,
    );
    redirectWith(res, `/lists/${list.id}`, { msg: `Imported: ${summarise(summary)}.` });
  });

  router.post("/lists/:id/import/url", (req, res) => {
    void (async () => {
      const list = requireList(req, res);
      if (!list) return;

      const url = trimmed(req.body?.url);
      if (url === "") {
        redirectWith(res, `/lists/${list.id}`, { err: "A playlist URL is required." });
        return;
      }

      const provider = createProvider(db, { list_id: list.id, kind: "m3u", url });

      try {
        const summary = await syncM3uProvider(provider);
        redirectWith(res, `/lists/${list.id}`, { msg: `Imported: ${summarise(summary)}.` });
      } catch (error) {
        // Keep the provider so the URL can be corrected and retried.
        redirectWith(res, `/lists/${list.id}`, { err: errorMessage(error) });
      }
    })();
  });

  async function syncM3uProvider(provider: Provider): Promise<ImportSummary> {
    const text = await fetchPlaylist(provider.url);
    const parsed = parseM3u(text);

    if (parsed.entries.length === 0) {
      const reason = `No channels found in the playlist. ${parsed.warnings[0] ?? ""}`.trim();
      recordProviderSync(db, provider.id, reason);
      throw new Error(reason);
    }

    const summary = applyImport(
      db,
      provider.list_id,
      providerScope(provider.id),
      toImportEntries(parsed.entries),
      parsed.warnings,
    );
    recordProviderSync(db, provider.id, summarise(summary));
    return summary;
  }

  async function syncXtreamProvider(provider: Provider): Promise<ImportSummary> {
    const result = await fetchXtreamChannels({
      baseUrl: provider.url,
      username: provider.username ?? "",
      password: provider.password ?? "",
      outputFormat: provider.output_format,
    });

    if (result.entries.length === 0) {
      const reason = "The Xtream account returned no live channels.";
      recordProviderSync(db, provider.id, reason);
      throw new Error(reason);
    }

    const summary = applyImport(
      db,
      provider.list_id,
      providerScope(provider.id),
      result.entries,
      result.warnings,
    );
    recordProviderSync(db, provider.id, summarise(summary));
    return summary;
  }

  router.post("/lists/:id/providers/xtream", (req, res) => {
    void (async () => {
      const list = requireList(req, res);
      if (!list) return;

      const url = trimmed(req.body?.url);
      const username = trimmed(req.body?.username);
      const password = trimmed(req.body?.password);

      if (url === "" || username === "" || password === "") {
        redirectWith(res, `/lists/${list.id}`, {
          err: "Server, username and password are all required.",
        });
        return;
      }

      const provider = createProvider(db, {
        list_id: list.id,
        kind: "xtream",
        url,
        username,
        password,
        output_format: optional(req.body?.output_format),
      });

      try {
        const summary = await syncXtreamProvider(provider);
        redirectWith(res, `/lists/${list.id}`, { msg: `Synced: ${summarise(summary)}.` });
      } catch (error) {
        redirectWith(res, `/lists/${list.id}`, { err: errorMessage(error) });
      }
    })();
  });

  router.post("/providers/:id/sync", (req, res) => {
    void (async () => {
      const id = numericParam(req, "id");
      const provider = id === null ? undefined : getProvider(db, id);

      if (!provider) {
        res.status(404).type("html").send(layout({ title: "Not found", body: "<p>No such provider.</p>" }));
        return;
      }

      try {
        const summary =
          provider.kind === "xtream"
            ? await syncXtreamProvider(provider)
            : await syncM3uProvider(provider);
        redirectWith(res, `/lists/${provider.list_id}`, { msg: `Synced: ${summarise(summary)}.` });
      } catch (error) {
        redirectWith(res, `/lists/${provider.list_id}`, { err: errorMessage(error) });
      }
    })();
  });

  router.post("/providers/:id/delete", (req, res) => {
    const id = numericParam(req, "id");
    const provider = id === null ? undefined : getProvider(db, id);

    if (!provider) {
      res.status(404).type("html").send(layout({ title: "Not found", body: "<p>No such provider.</p>" }));
      return;
    }

    deleteProvider(db, provider.id);
    redirectWith(res, `/lists/${provider.list_id}`, { msg: "Provider removed." });
  });

  /* ------------------------------------------------------------ health --- */

  router.post("/lists/:id/healthcheck", (req, res) => {
    void (async () => {
      const list = requireList(req, res);
      if (!list) return;

      if (countChannels(db, list.id) === 0) {
        redirectWith(res, `/lists/${list.id}`, { err: "Nothing to check yet." });
        return;
      }

      try {
        const summary = await probeList(db, list.id);
        redirectWith(res, `/lists/${list.id}`, {
          msg: `Checked ${summary.checked}: ${summary.ok} ok, ${summary.dead} dead, ${summary.unknown} not probeable.`,
        });
      } catch (error) {
        redirectWith(res, `/lists/${list.id}`, { err: errorMessage(error) });
      }
    })();
  });

  return router;
}
