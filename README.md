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

What changed in each release is listed in [CHANGELOG.md](CHANGELOG.md).

## Quick start

```bash
git clone https://github.com/PSubutai/NuvioM3U.git
cd NuvioM3U
docker compose up -d --build
```

Open <http://localhost:7000>, create a list, add some streams, then copy the
manifest URL from the install panel (or scan the QR code) and paste it into
Nuvio/Stremio's addon search box.

## Deploying with Docker

There is no published image yet, so you build it yourself. The build is
self-contained — it compiles TypeScript and the native SQLite module inside the
image, so you need nothing on the host but Docker.

### Build the image

```bash
git clone https://github.com/PSubutai/NuvioM3U.git
cd NuvioM3U
docker build -t nuviom3u:latest .
```

### Run it with compose

Copy `.env.example` to `.env`, set `PUBLIC_URL` and `ADMIN_PASSWORD`, then:

```bash
docker compose up -d
```

Compose reads `.env` automatically. This is the recommended path because
updating is a single command.

### Run it by hand

```bash
docker run -d \
  --name nuviom3u \
  --restart unless-stopped \
  -p 7000:7000 \
  -v /srv/nuviom3u:/config \
  -e PUBLIC_URL=https://m3u.example.com \
  -e ADMIN_PASSWORD='a-long-random-string' \
  nuviom3u:latest
```

Check it came up:

```bash
curl http://localhost:7000/healthz     # -> {"ok":true}
```

### Updating

With compose, one command does everything:

```bash
git pull
docker compose up -d --build
```

**If you started the container by hand, `docker restart` will not pick up a
rebuilt image.** A container is bound to the image *ID* it was created from.
Rebuilding `nuviom3u:latest` produces a new image and merely moves the tag —
the existing container still points at the old image ID, so restarting it
silently keeps running the old code. You have to replace the container:

```bash
git pull
docker build -t nuviom3u:latest .
docker rm -f nuviom3u
docker run -d --name nuviom3u ...      # the same run command as before
```

Removing the container is safe: your data lives on the `/config` volume, not
inside the container. To confirm which image a container is actually running:

```bash
docker inspect nuviom3u    --format '{{.Image}}'
docker inspect nuviom3u:latest --format '{{.Id}}'   # these should match
```

### Backups

Everything lives in one SQLite file on the `/config` volume:

```
<your /config path>/nuviom3u.db
```

Back that file up. Restoring it restores every list, including the slugs, so
addons already installed in Nuvio/Stremio keep working.

It also contains your Xtream passwords and any credentials embedded in M3U
URLs, in plaintext — treat the backup as a secret.

## Configuration

All settings are environment variables. See `.env.example` for an annotated
copy.

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `7000` | HTTP port. |
| `DB_PATH` | `/config/nuviom3u.db` | SQLite database. Back this file up. |
| `PUBLIC_URL` | *(derived)* | Public origin, e.g. `https://m3u.example.com`. **Set this behind a reverse proxy.** |
| `TRUST_PROXY` | `true` | Trust `X-Forwarded-Proto` / `X-Forwarded-Host`. |
| `ADMIN_PASSWORD` | *(unset)* | Unset means no password on the admin UI. Set it to require one. |
| `HEALTHCHECK_INTERVAL_MINUTES` | `0` | Automatic stream probing. `0` disables it. |
| `PUID` / `PGID` | `99` / `100` | Ownership of `/config`. |

### Behind a reverse proxy

Point the proxy at the container on port `7000`, then **set `PUBLIC_URL` to the
public HTTPS address**, with no trailing slash. Without it the admin UI
generates manifest URLs pointing at the container's internal address; they
install without error and then show an empty list. This is the single most
common way to misconfigure the deployment.

`TRUST_PROXY=true` lets the app fall back to `X-Forwarded-Proto` and
`X-Forwarded-Host` when `PUBLIC_URL` is unset, but setting `PUBLIC_URL`
explicitly is more reliable.

### Access control

**Do not put SSO in front of this.** Stremio and Nuvio cannot sign in. If an
authentication layer (Pangolin, Authelia, oauth2-proxy, Cloudflare Access)
covers the whole hostname, the client receives a login redirect instead of your
manifest, and the addon installs but shows nothing.

The routes under `/s/<slug>/` are deliberately unauthenticated. The unguessable
slug is what protects them — treat a manifest URL as a secret, and rotate it if
it leaks.

`ADMIN_PASSWORD` protects only the admin UI. The right split is:

1. Leave the proxy resource **unauthenticated**, targeting `http://<host>:7000`.
2. Set **`ADMIN_PASSWORD`** so the admin UI authenticates on its own.
3. The `/s/<slug>/` routes stay reachable for Stremio.

Leaving `ADMIN_PASSWORD` unset is only reasonable if nothing untrusted can reach
the container at all, because **your M3U URLs usually contain your IPTV username
and password** and the admin UI displays them in full.

If your proxy supports per-path rules you can instead authenticate `/` while
leaving `/s/` open. The `ADMIN_PASSWORD` approach above works regardless and
needs no proxy features.

## Unraid

Unraid works the same way, with two wrinkles: its Docker tab cannot build
images, and updating needs *Apply* rather than *Restart*.

Two directories are involved, and they should stay separate — keep the source
checkout out of `appdata` so re-cloning can never touch your database.

| | Path |
|---|---|
| Source | `/mnt/user/appdata/nuviom3u-src` |
| Data (`/config`) | `/mnt/user/appdata/nuviom3u` |

### 1. Put the source on the array

```bash
mkdir -p /mnt/user/appdata/nuviom3u-src
cd /mnt/user/appdata/nuviom3u-src
git clone https://github.com/PSubutai/NuvioM3U.git .
```

### 2. Build the image

Unraid's Docker tab cannot build images — use the terminal.

```bash
cd /mnt/user/appdata/nuviom3u-src
docker build -t nuviom3u:latest .
```

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
| `ADMIN_PASSWORD` | a long random string |

Unraid will report "update not available" for a locally built image. That is
expected and harmless.

### 4. Verify

```bash
curl http://<unraid-ip>:7000/healthz     # -> {"ok":true}
```

### Updating on Unraid

```bash
cd /mnt/user/appdata/nuviom3u-src
git pull
docker build -t nuviom3u:latest .
```

Then **Docker → NuvioM3U → Edit → Apply**.

**Do not use Restart.** Restart reuses the existing container, which is still
bound to the old image ID, so it silently keeps running the old code — the
rebuild appears to have done nothing. Edit → Apply performs a fresh `docker run`
against the rebuilt image. You do not need to change any setting; opening Edit
and pressing Apply is enough.

Your lists are safe: they live on the `/config` volume at
`/mnt/user/appdata/nuviom3u`, not inside the container.

### Alternative: Compose Manager

If you prefer compose, install the **Compose Manager** plugin from Community
Applications and point it at the bundled `docker-compose.yml`. Set `PUBLIC_URL`
and `ADMIN_PASSWORD` in `.env` first. Updating is then
`docker compose up -d --build`, which recreates the container for you and avoids
the Restart pitfall entirely.

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

The app does not read `.env` on its own. To use one locally:

```bash
node --env-file=.env --watch src/index.ts
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
