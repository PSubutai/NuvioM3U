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
cp .env.example .env        # then set PUBLIC_URL and ADMIN_PASSWORD
docker compose pull
docker compose up -d
```

Open <http://localhost:7000>, create a list, add some streams, then copy the
manifest URL from the install panel (or scan the QR code) and paste it into
Nuvio/Stremio's addon search box.

## Deploying with Docker

Prebuilt images are published to the GitHub Container Registry:

```
ghcr.io/psubutai/nuviom3u
```

### Image tags

| Tag | What it is |
|---|---|
| `latest` | The newest release. Use this. |
| `0.2.0`, `0.2` | A specific release, or the newest patch of a minor version. Use these to pin. |
| `dev` | The `dev` branch, rebuilt on every push. Work in progress — it can break. |
| `main` | The `main` branch at its last manual build. |
| `sha-abc1234` | One exact commit. Useful for rolling back. |

Images are built for `linux/amd64`.

### Run it with compose

Copy `.env.example` to `.env`, set `PUBLIC_URL` and `ADMIN_PASSWORD`, then:

```bash
docker compose pull
docker compose up -d
```

Compose reads `.env` automatically. Set `NUVIOM3U_TAG` there to pull a tag
other than `latest`. This is the recommended path because updating is two
commands.

### Run it by hand

```bash
docker run -d \
  --name nuviom3u \
  --restart unless-stopped \
  -p 7000:7000 \
  -v /srv/nuviom3u:/config \
  -e PUBLIC_URL=https://m3u.example.com \
  -e ADMIN_PASSWORD='a-long-random-string' \
  ghcr.io/psubutai/nuviom3u:latest
```

Check it came up:

```bash
curl http://localhost:7000/healthz     # -> {"ok":true}
```

### Updating

With compose, pull the new image and compose recreates the container for you:

```bash
docker compose pull
docker compose up -d
```

**If you started the container by hand, `docker restart` will not pick up a
new image.** A container is bound to the image *ID* it was created from.
Pulling or rebuilding `ghcr.io/psubutai/nuviom3u:latest` produces a new image
and merely moves the tag — the existing container still points at the old
image ID, so restarting it silently keeps running the old code. You have to
replace the container:

```bash
docker pull ghcr.io/psubutai/nuviom3u:latest
docker rm -f nuviom3u
docker run -d --name nuviom3u ...      # the same run command as before
```

Removing the container is safe: your data lives on the `/config` volume, not
inside the container. To confirm which image a container is actually running:

```bash
docker inspect nuviom3u --format '{{.Image}}'
docker inspect ghcr.io/psubutai/nuviom3u:latest --format '{{.Id}}'   # these should match
```

### Building from source

The build is self-contained — it compiles TypeScript and the native SQLite
module inside the image, so you need nothing on the host but Docker. The
compose file keeps its `build:` section, so from a checkout:

```bash
git pull
docker compose up -d --build
```

This builds locally and tags the result with the same image name, so the rest
of this guide applies unchanged. Without compose:

```bash
docker build -t ghcr.io/psubutai/nuviom3u:latest .
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

The bundled template points at the published image, so Unraid pulls and
updates it like any other container.

### 1. Install the template

From the Unraid terminal, download the template so it appears in the Docker
tab:

```bash
curl -fsSL -o /boot/config/plugins/dockerMan/templates-user/my-NuvioM3U.xml \
  https://raw.githubusercontent.com/PSubutai/NuvioM3U/main/unraid-template.xml
```

### 2. Add the container

**Docker → Add Container → NuvioM3U**, and set:

| Setting | Value |
|---|---|
| Port | `7000` |
| `/config` | `/mnt/user/appdata/nuviom3u` |
| `PUBLIC_URL` | `https://m3u.example.com` (no trailing slash) |
| `ADMIN_PASSWORD` | a long random string |

To run the `dev` build instead, change *Repository* to
`ghcr.io/psubutai/nuviom3u:dev`.

### 3. Verify

```bash
curl http://<unraid-ip>:7000/healthz     # -> {"ok":true}
```

### Updating on Unraid

When a new image is published, the Docker tab shows **update ready**. Click it
and choose **apply update**. Unraid pulls the image and recreates the
container.

Your lists are safe: they live on the `/config` volume at
`/mnt/user/appdata/nuviom3u`, not inside the container.

### Building from source on Unraid

Only do this if you need unreleased code that is not in any published image.
Keep the source checkout out of the data directory so re-cloning can never
touch your database:

| | Path |
|---|---|
| Source | `/mnt/user/appdata/nuviom3u-src` |
| Data (`/config`) | `/mnt/user/appdata/nuviom3u` |

Unraid's Docker tab cannot build images — use the terminal:

```bash
mkdir -p /mnt/user/appdata/nuviom3u-src
cd /mnt/user/appdata/nuviom3u-src
git clone https://github.com/PSubutai/NuvioM3U.git .
docker build -t ghcr.io/psubutai/nuviom3u:latest .
```

To update, `git pull` and build again, then **Docker → NuvioM3U → Edit →
Apply**. A locally built image never shows "update ready", and pulling a
published image would replace your build.

**Do not use Restart.** Restart reuses the existing container, which is still
bound to the old image ID, so it silently keeps running the old code — the
rebuild appears to have done nothing. Edit → Apply performs a fresh `docker run`
against the rebuilt image. You do not need to change any setting; opening Edit
and pressing Apply is enough.

### Alternative: Compose Manager

If you prefer compose, install the **Compose Manager** plugin from Community
Applications and point it at the bundled `docker-compose.yml`. Set `PUBLIC_URL`
and `ADMIN_PASSWORD` in `.env` first. Updating is then `docker compose pull`
followed by `docker compose up -d`, which recreates the container for you.

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

### Branches and published images

Day-to-day work goes on the `dev` branch. The
[Docker image workflow](.github/workflows/docker.yml) runs typecheck, lint and
tests, then builds and pushes the image:

| Event | Tags pushed |
|---|---|
| Push to `dev` | `dev`, `sha-…` |
| Push a `vX.Y.Z` tag | `X.Y.Z`, `X.Y`, `latest`, `sha-…` |
| Manual run on `main` | `main`, `latest`, `sha-…` |

Pushes to `main` do not build on their own. To cut a release:

1. Bump `version` in `package.json` and move the `[Unreleased]` entries in
   `CHANGELOG.md` under the new version.
2. Merge `dev` into `main`.
3. Tag the release and push the tag:

   ```bash
   git tag v0.2.0
   git push origin v0.2.0
   ```

Once the image is published, the workflow creates the GitHub release for the
tag. The release notes are that version's section of `CHANGELOG.md`, followed by
the `docker pull` command for the image. Re-running the workflow updates the
release instead of failing.

The workflow fails before building anything if the tag does not match the
`package.json` version, or if `CHANGELOG.md` has no section for it. The
manifest version comes from `package.json`, and clients use it to refresh a
cached addon, so the two must agree.

To build `main` without releasing, open **Actions → Docker image → Run
workflow** and pick `main`, or run:

```bash
gh workflow run docker.yml --ref main
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
