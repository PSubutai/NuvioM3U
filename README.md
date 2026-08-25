# NuvioM3U

Self-hosted Nuvio/Stremio addon that turns collections of M3U live-stream URLs
into named lists. Create a list called "My Stream #01", fill it with streams
under names you choose, and install that list's manifest URL in Nuvio or
Stremio.

Every list gets its own manifest URL with a random 20-character slug, so the URL
cannot be guessed or stumbled upon.

```
https://m3u.example.com/s/Xq4Kd0mS2ZbA7pLwNvR8/manifest.json
```

## Features

- **Two display modes, chosen per list.**
  - *Bundle* — the list appears as one poster; clicking it lists every stream.
  - *Channels* — every stream is its own poster with its own logo. Paginated, so
    it handles playlists with hundreds of channels.
- **Bulk import** from an M3U/M3U8 playlist URL or pasted text, reading
  `tvg-name`, `tvg-logo` and `group-title`.
- **Xtream Codes accounts** — enter server, username and password to pull the
  live channel list.
- **Failover** — a channel can hold several URLs, shown in order so you can fall
  through when one dies.
- **Health checks** — probe every URL on demand or on a schedule. Dead URLs sink
  to the bottom of the stream list; they are never hidden, because a failed
  probe can be a false negative.
- **Custom artwork** — poster, logo and background per list, and per channel.
- **Slug rotation** — regenerate a list's URL to revoke access if it leaks.

## Quick start

```bash
docker compose up -d --build
```

Open <http://localhost:7000>, create a list, add some streams, then copy the
manifest URL from the install panel (or scan the QR code) and paste it into
Nuvio/Stremio's addon search box.

## Configuration

All settings are environment variables.

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `7000` | HTTP port. |
| `DB_PATH` | `/config/nuviom3u.db` | SQLite database. Back this file up. |
| `PUBLIC_URL` | *(derived)* | Public origin, e.g. `https://m3u.example.com`. **Set this behind a reverse proxy.** |
| `TRUST_PROXY` | `true` | Trust `X-Forwarded-Proto` / `X-Forwarded-Host`. |
| `ADMIN_PASSWORD` | *(unset)* | Unset means no password on the admin UI. Set it to require one. |
| `HEALTHCHECK_INTERVAL_MINUTES` | `0` | Automatic stream probing. `0` disables it. |
| `PUID` / `PGID` | `99` / `100` | Ownership of `/config`, Unraid convention. |

### Behind Pangolin / Traefik

Point your Pangolin resource (or Traefik router) at the container on port
`7000`, then **set `PUBLIC_URL` to the public HTTPS address**. Without it the
admin UI will generate manifest URLs pointing at the container's internal
address, and the addon will install but show nothing — the single most common
way to misconfigure this.

`TRUST_PROXY=true` lets the app fall back to `X-Forwarded-*` if `PUBLIC_URL` is
unset, but setting `PUBLIC_URL` explicitly is more reliable.

### A note on access control

The addon routes under `/s/<slug>/` are deliberately **not** password protected.
Stremio cannot sign in, so any addon endpoint must be reachable without
credentials. The unguessable slug is what protects them — treat a manifest URL
as a secret, and rotate it if it leaks.

`ADMIN_PASSWORD` protects only the admin UI. Leaving it unset is reasonable when
Pangolin authenticates in front, but note that **your M3U URLs usually contain
your IPTV username and password**, and the admin UI displays them. If anything
can reach the container directly, set a password.

## Unraid

There is no published image, so the first step is always to build one on the
server. Unraid's Docker tab cannot build images — use the terminal.

### 1. Put the source on the array

```bash
mkdir -p /mnt/user/appdata/nuviom3u-src
cd /mnt/user/appdata/nuviom3u-src
# copy the repo here over SMB, or:
git clone <your-repo-url> .
```

### 2. Build the image

```bash
cd /mnt/user/appdata/nuviom3u-src
docker build -t nuviom3u:latest .
```

Rebuild with the same command after pulling changes, then restart the container.

### 3. Add the container

Install the template so it appears in the Docker tab:

```bash
cp unraid-template.xml \
   /boot/config/plugins/dockerMan/templates-user/my-NuvioM3U.xml
```

Then **Docker → Add Container → NuvioM3U**, and set:

| Setting | Value |
|---|---|
| Port | `7000` |
| `/config` | `/mnt/user/appdata/nuviom3u` |
| `PUBLIC_URL` | `https://m3u.example.com` (no trailing slash) |
| `ADMIN_PASSWORD` | a long random string — see below |

Unraid will report "update not available" for a locally built image. That is
expected and harmless.

### Alternative: Compose Manager

If you prefer compose, install the **Compose Manager** plugin from Community
Applications and point it at the bundled `docker-compose.yml`. Set `PUBLIC_URL`
and `ADMIN_PASSWORD` in that file first. The container appears in the Docker tab
but is managed by the plugin rather than by an Unraid template.

### 4. Verify

```bash
curl http://<unraid-ip>:7000/healthz     # -> {"ok":true}
```

### Backups

Everything lives in one SQLite file:

```
/mnt/user/appdata/nuviom3u/nuviom3u.db
```

Include that path in your appdata backup. Restoring it restores every list,
including the slugs, so installed addons keep working.

## Publishing through Pangolin

**Do not enable Pangolin authentication on this resource.**

Stremio and Nuvio cannot sign in. If SSO sits in front of the whole hostname,
the client receives an auth redirect instead of your manifest, and the addon
installs but shows nothing.

The right split is:

1. Leave the Pangolin resource **unauthenticated**, targeting
   `http://<unraid-ip>:7000`.
2. Set **`ADMIN_PASSWORD`** so the admin UI authenticates on its own.
3. The `/s/<slug>/` routes stay reachable, protected by their unguessable slug.

Set `PUBLIC_URL` to the public hostname Pangolin serves. Without it the admin UI
generates manifest URLs pointing at the container's internal address — they
install without error and then show an empty list. This is the most common way
to misconfigure the deployment.

If your Pangolin version supports per-path rules, you can instead authenticate
`/` while leaving `/s/` open. Check its current documentation; the
`ADMIN_PASSWORD` approach above works regardless and needs no proxy features.

## Development

```bash
npm install
npm run dev        # watch mode, uses Node's native TypeScript support
npm test           # vitest
npm run typecheck
npm run lint
```

By default `DB_PATH` is `/config/nuviom3u.db`. For local work, point it
somewhere writable:

```bash
DB_PATH=./config/nuviom3u.db npm run dev
```

## How it maps onto the Stremio addon protocol

Each list is served as a complete, self-contained addon:

| Route | Purpose |
|---|---|
| `/s/:slug/manifest.json` | Addon manifest. `id` is `community.nuviom3u.<slug>`. |
| `/s/:slug/catalog/tv/main.json` | The catalog. Paginated with `skip` in channels mode. |
| `/s/:slug/meta/tv/:id.json` | Meta for a list (bundle) or a channel. |
| `/s/:slug/stream/tv/:id.json` | The stream list. |

Content ids are scoped to the slug — `m3u:<slug>:l` for a bundle,
`m3u:<slug>:c<id>` for a channel — and each manifest declares
`idPrefixes: ["m3u:<slug>:"]`. This matters: Stremio asks *every* installed
addon whose prefixes match a content id, so without slug scoping, one installed
list would be asked for another's channels.

Streams on non-HTTPS URLs are marked `behaviorHints.notWebReady`, which tells
the client to use a native player. Such streams will not play in Stremio **Web**
(mixed content is blocked), but work in the desktop, Android and Nuvio clients.

## License

MIT
