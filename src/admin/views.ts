import type { Channel, ChannelWithSources, List, Provider, Source } from "../db/repo.ts";
import { html, raw } from "./html.ts";

export interface InstallInfo {
  manifestUrl: string;
  stremioUrl: string;
  qrSvg: string | null;
}

export interface ListSummary extends List {
  channelCount: number;
  deadCount: number;
}

const MODE_LABEL: Record<string, string> = {
  bundle: "Bundle - one poster for the whole list",
  channels: "Channels - one poster per stream",
};

function modeSelect(selected: string): string {
  return html`<select name="display_mode">
    ${raw(
      Object.entries(MODE_LABEL)
        .map(
          ([value, label]) =>
            html`<option value="${value}" ${raw(value === selected ? "selected" : "")}>${label}</option>`,
        )
        .join(""),
    )}
  </select>`;
}

function healthBadge(sources: Source[]): string {
  if (sources.length === 0) return html`<span class="badge warn">no URL</span>`;

  const dead = sources.filter((source) => source.health_status === "dead").length;
  const ok = sources.filter((source) => source.health_status === "ok").length;
  const count = html`<span class="badge">${`${sources.length} URL${sources.length === 1 ? "" : "s"}`}</span>`;

  if (dead > 0 && dead === sources.length) {
    return count + html` <span class="badge dead">all dead</span>`;
  }
  if (dead > 0) return count + html` <span class="badge dead">${`${dead} dead`}</span>`;
  if (ok > 0) return count + html` <span class="badge ok">ok</span>`;
  return count;
}

export function renderListsPage(lists: ListSummary[]): string {
  // Both branches must be raw(): a bare html`` result is an ordinary string,
  // which the outer template would escape and render as visible markup.
  const rows =
    lists.length === 0
      ? raw(html`<tr><td colspan="4" class="muted">No lists yet. Create one below.</td></tr>`)
      : raw(
          lists
            .map(
              (list) => html`<tr>
                <td><a href="/lists/${list.id}"><strong>${list.name}</strong></a></td>
                <td class="small muted">${list.display_mode === "bundle" ? "Bundle" : "Channels"}</td>
                <td class="small">
                  ${`${list.channelCount} channel${list.channelCount === 1 ? "" : "s"}`}
                  ${raw(list.deadCount > 0 ? html` <span class="badge dead">${`${list.deadCount} dead`}</span>` : "")}
                </td>
                <td class="right">
                  <a class="btn" href="/lists/${list.id}">Open</a>
                </td>
              </tr>`,
            )
            .join(""),
        );

  return html`
    <section class="panel">
      <h2>Lists</h2>
      <table>
        <thead>
          <tr><th>Name</th><th>Mode</th><th>Contents</th><th class="right">&nbsp;</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </section>

    <section class="panel">
      <h2>New list</h2>
      <form method="post" action="/lists">
        <div class="row">
          <label><span>Name</span>
            <input type="text" name="name" placeholder="My Stream #01" required maxlength="200">
          </label>
          <label><span>Display mode</span>${raw(modeSelect("bundle"))}</label>
          <div class="action"><button class="primary" type="submit">Create list</button></div>
        </div>
      </form>
    </section>`;
}

function installPanel(list: List, install: InstallInfo): string {
  return html`
    <section class="panel">
      <h2>Install in Nuvio / Stremio</h2>
      <div class="install">
        ${raw(install.qrSvg ? html`<div class="qr">${raw(install.qrSvg)}</div>` : "")}
        <div class="details">
          <p class="small muted" style="margin-top:0">
            This URL contains a random slug so it cannot be guessed. Anyone who has it can watch this list.
          </p>
          <code class="url">${install.manifestUrl}</code>
          <div class="row" style="margin-top:.6rem">
            <div class="action">
              <button type="button" data-url="${install.manifestUrl}"
                onclick="navigator.clipboard.writeText(this.dataset.url).then(()=>{this.textContent='Copied'; setTimeout(()=>this.textContent='Copy URL',1500)})">
                Copy URL
              </button>
            </div>
            <div class="action"><a class="btn" href="${install.stremioUrl}">Open in Stremio</a></div>
            <div class="action">
              <form method="post" action="/lists/${list.id}/rotate-slug" class="inline"
                onsubmit="return confirm('Generate a new URL? The current one stops working everywhere it is installed.')">
                <button class="danger" type="submit">Rotate URL</button>
              </form>
            </div>
          </div>
        </div>
      </div>
    </section>`;
}

function channelRows(list: List, channels: ChannelWithSources[]): string {
  if (channels.length === 0) {
    return html`<tr><td colspan="5" class="muted">No channels yet. Add one below, or import a playlist.</td></tr>`;
  }

  return channels
    .map(
      (channel, index) => html`<tr>
          <td>
            ${raw(
              channel.logo_url
                ? html`<img class="logo-thumb" src="${channel.logo_url}" alt="">`
                : "",
            )}
          </td>
          <td>
            <a href="/channels/${channel.id}"><strong>${channel.name}</strong></a>
            ${raw(channel.enabled === 0 ? html` <span class="badge warn">hidden</span>` : "")}
            ${raw(channel.group_title ? html`<div class="small muted">${channel.group_title}</div>` : "")}
          </td>
          <td>${raw(healthBadge(channel.sources))}</td>
          <td class="right">
            <form method="post" action="/channels/${channel.id}/move" class="inline">
              <input type="hidden" name="direction" value="up">
              <button class="link" type="submit" title="Move up" ${raw(index === 0 ? "disabled" : "")}>&uarr;</button>
            </form>
            <form method="post" action="/channels/${channel.id}/move" class="inline">
              <input type="hidden" name="direction" value="down">
              <button class="link" type="submit" title="Move down"
                ${raw(index === channels.length - 1 ? "disabled" : "")}>&darr;</button>
            </form>
          </td>
          <td class="right">
            <form method="post" action="/channels/${channel.id}/toggle" class="inline">
              <button class="link" type="submit">${channel.enabled === 1 ? "Hide" : "Show"}</button>
            </form>
            <a class="btn" href="/channels/${channel.id}">Edit</a>
            <form method="post" action="/channels/${channel.id}/delete" class="inline"
              onsubmit="return confirm('Delete ${channel.name.replaceAll("'", "")}?')">
              <button class="link danger" type="submit">Delete</button>
            </form>
          </td>
        </tr>`,
      )
    .join("");
}

function providerRows(providers: Provider[]): string {
  if (providers.length === 0) {
    return html`<tr><td colspan="3" class="muted">No providers. Add a playlist URL or an Xtream account below.</td></tr>`;
  }

  return providers
      .map(
        (provider) => html`<tr>
          <td>
            <span class="badge">${provider.kind === "xtream" ? "Xtream" : "M3U"}</span>
            <div class="small mono" style="word-break:break-all">${provider.url}</div>
            ${raw(provider.username ? html`<div class="small muted">user: ${provider.username}</div>` : "")}
          </td>
          <td class="small muted">
            ${raw(
              provider.last_sync_at
                ? html`${new Date(provider.last_sync_at).toLocaleString()}<div>${provider.last_sync_result}</div>`
                : html`never synced`,
            )}
          </td>
          <td class="right">
            <form method="post" action="/providers/${provider.id}/sync" class="inline">
              <button type="submit">Sync now</button>
            </form>
            <form method="post" action="/providers/${provider.id}/delete" class="inline"
              onsubmit="return confirm('Remove this provider? Imported channels stay in the list.')">
              <button class="link danger" type="submit">Remove</button>
            </form>
          </td>
        </tr>`,
      )
      .join("");
}

export function renderListPage(options: {
  list: List;
  channels: ChannelWithSources[];
  providers: Provider[];
  install: InstallInfo;
}): string {
  const { list, channels, providers, install } = options;

  return (
    installPanel(list, install) +
    html`
      <section class="panel">
        <h2>Channels</h2>
        <table>
          <thead>
            <tr><th style="width:2.5rem"></th><th>Name</th><th>URLs</th><th class="right">Order</th><th class="right">&nbsp;</th></tr>
          </thead>
          <tbody>${raw(channelRows(list, channels))}</tbody>
        </table>

        <h3>Add a channel</h3>
        <form method="post" action="/lists/${list.id}/channels">
          <div class="row">
            <label><span>Name shown in Stremio</span>
              <input type="text" name="name" placeholder="BBC One HD" required maxlength="200">
            </label>
            <label><span>Stream URL</span>
              <input type="url" name="url" placeholder="https://example.com/live.m3u8" required>
            </label>
            <div class="action"><button class="primary" type="submit">Add</button></div>
          </div>
        </form>

        <h3>Check stream health</h3>
        <form method="post" action="/lists/${list.id}/healthcheck">
          <button type="submit">Check all URLs now</button>
          <span class="small muted">Dead URLs are moved to the bottom of the stream list, never hidden.</span>
        </form>
      </section>

      <section class="panel">
        <h2>Import</h2>
        <h3>From an M3U playlist URL</h3>
        <form method="post" action="/lists/${list.id}/import/url">
          <div class="row">
            <label><span>Playlist URL</span>
              <input type="url" name="url" placeholder="https://provider.example/get.php?username=...&amp;type=m3u_plus" required>
            </label>
            <div class="action"><button class="primary" type="submit">Import</button></div>
          </div>
          <p class="small muted" style="margin:0">Saved as a provider so you can re-sync it later.</p>
        </form>

        <h3>Paste a playlist</h3>
        <form method="post" action="/lists/${list.id}/import/paste">
          <label>
            <textarea name="text" placeholder="#EXTM3U&#10;#EXTINF:-1 tvg-logo=&quot;...&quot;,Channel Name&#10;https://..." required></textarea>
          </label>
          <button class="primary" type="submit">Import pasted playlist</button>
        </form>

        <h3>Xtream Codes account</h3>
        <form method="post" action="/lists/${list.id}/providers/xtream">
          <div class="row">
            <label><span>Server</span><input type="text" name="url" placeholder="http://provider.example:8080" required></label>
            <label><span>Username</span><input type="text" name="username" required></label>
            <label><span>Password</span><input type="password" name="password" required></label>
            <label class="narrow"><span>Format</span>
              <select name="output_format">
                <option value="">auto</option>
                <option value="ts">ts</option>
                <option value="m3u8">m3u8</option>
              </select>
            </label>
            <div class="action"><button class="primary" type="submit">Add &amp; sync</button></div>
          </div>
        </form>

        <h3>Providers</h3>
        <table>
          <thead><tr><th>Source</th><th>Last sync</th><th class="right">&nbsp;</th></tr></thead>
          <tbody>${raw(providerRows(providers))}</tbody>
        </table>
      </section>

      <section class="panel">
        <h2>List settings</h2>
        <form method="post" action="/lists/${list.id}">
          <div class="grid2">
            <label><span>Name</span><input type="text" name="name" value="${list.name}" required maxlength="200"></label>
            <label><span>Display mode</span>${raw(modeSelect(list.display_mode))}</label>
            <label><span>Description</span><input type="text" name="description" value="${list.description ?? ""}"></label>
            <label><span>Poster URL</span><input type="url" name="poster_url" value="${list.poster_url ?? ""}"></label>
            <label><span>Logo URL</span><input type="url" name="logo_url" value="${list.logo_url ?? ""}"></label>
            <label><span>Background URL</span><input type="url" name="background_url" value="${list.background_url ?? ""}"></label>
          </div>
          <button class="primary" type="submit">Save settings</button>
        </form>

        <h3>Danger zone</h3>
        <form method="post" action="/lists/${list.id}/delete"
          onsubmit="return confirm('Delete this list and all of its channels? This cannot be undone.')">
          <button class="danger" type="submit">Delete this list</button>
        </form>
      </section>`
  );
}

function sourceRows(channel: Channel, sources: Source[]): string {
  if (sources.length === 0) {
    return html`<tr><td colspan="4" class="muted">No URLs yet. Add one below.</td></tr>`;
  }

  return sources
      .map(
        (source, index) => html`<tr>
          <td>
            <div class="small mono" style="word-break:break-all">${source.url}</div>
            ${raw(source.label ? html`<div class="small muted">${source.label}</div>` : "")}
          </td>
          <td class="small">
            ${raw(
              source.health_status === "ok"
                ? html`<span class="badge ok">ok</span>`
                : source.health_status === "dead"
                  ? html`<span class="badge dead">dead</span>`
                  : html`<span class="badge">unchecked</span>`,
            )}
            ${raw(source.health_detail ? html`<div class="muted">${source.health_detail}</div>` : "")}
          </td>
          <td class="right">
            <form method="post" action="/sources/${source.id}/move" class="inline">
              <input type="hidden" name="direction" value="up">
              <button class="link" type="submit" ${raw(index === 0 ? "disabled" : "")}>&uarr;</button>
            </form>
            <form method="post" action="/sources/${source.id}/move" class="inline">
              <input type="hidden" name="direction" value="down">
              <button class="link" type="submit" ${raw(index === sources.length - 1 ? "disabled" : "")}>&darr;</button>
            </form>
          </td>
          <td class="right">
            <form method="post" action="/sources/${source.id}/delete" class="inline"
              onsubmit="return confirm('Delete this URL?')">
              <button class="link danger" type="submit">Delete</button>
            </form>
          </td>
        </tr>`,
      )
      .join("");
}

export function renderChannelPage(options: {
  list: List;
  channel: Channel;
  sources: Source[];
}): string {
  const { list, channel, sources } = options;

  return html`
    <section class="panel">
      <h2>${channel.name}</h2>
      <p class="small muted" style="margin-top:0">
        in <a href="/lists/${list.id}">${list.name}</a>
      </p>
      <form method="post" action="/channels/${channel.id}">
        <div class="grid2">
          <label><span>Name shown in Stremio</span>
            <input type="text" name="name" value="${channel.name}" required maxlength="200"></label>
          <label><span>Group</span><input type="text" name="group_title" value="${channel.group_title ?? ""}"></label>
          <label><span>Description</span><input type="text" name="description" value="${channel.description ?? ""}"></label>
          <label><span>Logo URL</span><input type="url" name="logo_url" value="${channel.logo_url ?? ""}"></label>
          <label><span>Poster URL</span><input type="url" name="poster_url" value="${channel.poster_url ?? ""}"></label>
        </div>
        <button class="primary" type="submit">Save channel</button>
      </form>
    </section>

    <section class="panel">
      <h2>Stream URLs</h2>
      <p class="small muted" style="margin-top:0">
        Listed in order. Stremio shows them all, so extra URLs act as manual failover.
      </p>
      <table>
        <thead><tr><th>URL</th><th>Health</th><th class="right">Order</th><th class="right">&nbsp;</th></tr></thead>
        <tbody>${raw(sourceRows(channel, sources))}</tbody>
      </table>

      <h3>Add a URL</h3>
      <form method="post" action="/channels/${channel.id}/sources">
        <div class="row">
          <label><span>Stream URL</span><input type="url" name="url" required></label>
          <label class="narrow"><span>Label</span><input type="text" name="label" placeholder="1080p"></label>
          <div class="action"><button class="primary" type="submit">Add URL</button></div>
        </div>
      </form>
    </section>

    <section class="panel">
      <h3>Danger zone</h3>
      <form method="post" action="/channels/${channel.id}/delete"
        onsubmit="return confirm('Delete this channel?')">
        <button class="danger" type="submit">Delete this channel</button>
      </form>
    </section>`;
}

export function renderLoginPage(error: string | null): string {
  return html`
    <section class="panel" style="max-width:24rem;margin:3rem auto">
      <h2>Sign in</h2>
      ${raw(error ? html`<div class="flash err">${error}</div>` : "")}
      <form method="post" action="/login">
        <label><span>Admin password</span><input type="password" name="password" autofocus required></label>
        <button class="primary" type="submit">Sign in</button>
      </form>
    </section>`;
}
