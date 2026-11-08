# Inspo

A portable, local-first workflow for curating design inspiration, plus a gallery to browse it. Each item is a clip, screenshot or link with a note on why it's worth keeping.

- **Local-first.** Everything lives in one `data/` folder on your machine. There's no account, no database and no cloud service.
- **Portable.** The `data/` folder is the part that matters: a simple structure and one JSON format, defined in [`schema/inspo-v1.schema.json`](schema/inspo-v1.schema.json). Copy it anywhere, back it up, or read it with any tool that reads JSON.
- **Private by design.** The Claude Code harness includes a privacy guard. Before Claude runs a command or fetches a page, it blocks anything that would send your email, name, username, cookies or credentials to a website. Download tools are checked for known vulnerabilities before they're installed and every time they run.
- **Extensible.** The data is plain files behind a small HTTP API, so the folder could later be hosted on a remote server. That isn't built yet.

## How it works

Capture items anywhere: in Claude (desktop or phone), add a link and a few words to your capture document, a Claude Artifact whose link is `source_doc` in `data/gallery.json`. Then add them to the gallery in one of three ways:

1. **Fully automated.** Ask Claude Code, in this folder, to complete the unfinished items. It downloads the media, looks at it, writes the description and tags, and updates your document.
2. **Semi-automated.** Drop media you downloaded into `data/incoming/` (as `di-043.mp4` or `di-043/…`), then ask Claude Code as above.
3. **Fully manual.** In the app, click **New entry**.

Diagrams and details are in [ARCHITECTURE.md](ARCHITECTURE.md).

## Setup

Requires Node.js 20+, pnpm and gpg.

```sh
pnpm i
pnpm tools install   # vets, verifies and installs yt-dlp and ffmpeg into tools/
pnpm dev             # http://localhost:5173
```

On macOS, install ffmpeg with `brew install ffmpeg`; `pnpm tools install` still checks it.

## Your data

```
data/
  gallery.json   entries, categories and tags (schema: inspo/v1)
  media/         videos and images (not in git; copy between machines)
  incoming/      drop folder for media not yet in the gallery (not in git)
```

`pnpm check` validates the folder.
