# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-08-25

### Added

- Create named lists of M3U live streams and install each one in Nuvio or Stremio from its own manifest URL
- Give every list an unguessable 20-character URL, and rotate it to revoke access if it ever leaks
- Install a list from the admin UI by copying its manifest URL or scanning a QR code
- Choose per list whether it appears as one poster listing all its streams, or as one poster per channel with its own logo, paged so playlists of hundreds of channels stay usable
- Import channels in bulk from an M3U/M3U8 URL or pasted playlist text, keeping the names, logos and groups the playlist carries
- Pull live channels from an Xtream Codes account by entering the server, username and password
- Re-import or re-sync at any time without creating duplicates or losing channels you edited; channels that vanish upstream are reported rather than deleted
- Give a channel several URLs so you can fall through to a backup when one dies, and reorder channels and streams to control what appears first
- Check whether streams are still alive, on demand or on a schedule; dead ones sink to the bottom of the stream list rather than disappearing, since a failed check can be wrong
- Set custom poster, logo and background artwork per list and per channel
- Password-protect the admin UI while leaving list URLs reachable for players that cannot sign in
- Run it as a Docker container with everything stored in a single SQLite file, using the included compose file or Unraid template

[Unreleased]: https://github.com/PSubutai/NuvioM3U/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/PSubutai/NuvioM3U/releases/tag/v0.1.0
