# Architecture

How Inspo fits together: the three ways items arrive, and the parts that move them.

## Workflows

The capture document (a Claude Artifact) is the source of truth. Every item starts there as a row (ID, date, link, a few words), then reaches the gallery in one of three ways.

```
                   Claude chat (desktop or phone)
                                |
                                v
               +---------------------------------+
               |  Capture document (Artifact)    |   source of truth:
               |  di-043 | link | "a few words"  |   ID, date, link, note
               +---------------------------------+
                                |
        +-----------------------+------------------------+
        |                       |                        |
 1. Fully automated      2. Semi-automated        3. Fully manual
 Claude Code downloads   You download the media   In the app: New entry.
 the media into          and drop it into         Upload files, or attach
 data/incoming/<id>/     data/incoming/<id>/      from data/incoming/
        |                       |                        |
        +-----------+-----------+                        |
                    v                                    |
       Claude Code: pnpm ingest <id> [url]               |
       frames + post text -> Claude looks at them,       |
       writes title, why, tags -> pnpm entry put         |
                    |                                    |
                    v                                    v
       +------------------------------------------------------+
       |  data/gallery.json  +  data/media/di-NNN-<slug>.ext  |
       +------------------------------------------------------+
                    |                                    |
                    v                                    v
       Claude updates the capture           Add the entry to the capture
       document (row, tab, counts)          document at the next sync
```

- **Fully automated:** `pnpm ingest <id> <url>` downloads into `data/incoming/<id>/`.
- **Semi-automated:** the user puts files there first, and `ingest` skips the download.
- **Both automated paths:** `ingest` extracts frames into `incoming/<id>/.frames/` and fetches the post text. Claude looks at the frames, writes the entry with `pnpm entry put`, and the files move into `data/media/`.
- **Fully manual:** the server assigns the ID, so the entry is added to the capture document at the next sync.

## Components

```
 Browser                        Node: Vite dev / preview server             Disk
+----------------------+       +-------------------------------------+     +------------------+
| Web client           | HTTP  | API plugin       server/plugin.ts   |     | data/            |
| React + Base UI      |<----->|  GET    /api/gallery                |     |   gallery.json   |
|  grid, search,       |       |  POST   /api/entries                |     |   media/         |
|  viewer, editor      |       |  PUT    /api/entries/:id            |     |     posters/     |
|  (search and URL     |       |  DELETE /api/entries/:id            |     |   incoming/      |
|   state run in the   |       |  POST   /api/entries/:id/media      |     +------------------+
|   browser)           |       |  POST   /api/tags                   |              ^
+----------------------+       |  GET    /api/media/unreferenced     |              |
                               |  GET    /media/*  /incoming/*       |              |
                               |              |                      |              |
                               |  Store       server/store.ts  ------+--------------+
                               |  validate -> atomic write           |   read/write
                               |  Posters     ffmpeg (audited)       |
                               +-------------------------------------+
                                              ^
                                              | same store
 Claude Code session                          |
+----------------------+       +-------------------------+       +---------------------------+
| complete-items skill |------>| CLI scripts             |------>| tools/bin/                |
| privacy-guard hook   |       |  pnpm ingest            |       |  yt-dlp, ffmpeg           |
| Docs connector       |       |  pnpm entry put         |       |  audited (OSV.dev / NVD), |
|   <-> capture doc    |       |  pnpm check             |       |  verified, input-guarded  |
+----------------------+       +-------------------------+       +---------------------------+
```

| Part | Where | What it does |
| --- | --- | --- |
| Web client | `src/` | React + Base UI, built with Vite: grid, search, viewer, editor. Search, filters and URL state run in the browser; every change goes through the API. |
| API server | `server/plugin.ts` | A Vite plugin, so `pnpm dev` and `pnpm preview` serve the app and the API from one process. Serves `/media/*` and `/incoming/*` with range requests and makes missing posters on request. |
| Store | `server/store.ts` | The only writer of `gallery.json`. Serialises writes, validates, then writes atomically (temp file + rename). Moves attached files from `incoming/` into `media/`. |
| Validation | `schema/inspo-v1.schema.json`, `src/lib/validate.ts` | ajv checks structure against the JSON Schema. Code checks the cross-references a schema can't express: tags and categories exist, IDs are unique and below `next_id`, media files exist. |
| CLI scripts | `scripts/` | `ingest`, `entry`, `check`, `tools`. They use the same store, so they work without the server. |
| Harness | `.claude/` | The `complete-items` skill. Settings that allow the harness commands and deny raw downloaders and browser-control tools. A SessionStart tool check. The privacy guard. |
| Privacy guard | `.claude/hooks/privacy-guard.mjs` | Runs before every shell command and web request Claude makes. Blocks any that would carry the user's email, name, username or hostname, custom headers or cookies, or a direct downloader call. The identifiers are read at runtime, never stored. |
| External tools | `tools/bin/` (not in git) | yt-dlp and ffmpeg. `pnpm tools install` installs them only after an OSV.dev/NVD audit and signature/checksum checks, and they are re-audited before every use. ffmpeg reads only local video files. New npm dependencies are checked with `pnpm tools vet` first. |
