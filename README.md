# Inspo

A portable, local-first workflow for curating design inspiration, plus a gallery to browse it. Each item is a clip, screenshot or link with a note on why it's worth keeping.

- **Local-first.** Everything lives in one `data/` folder on your machine. There's no account, no database and no cloud service; the app reads and writes plain files.
- **Portable.** The `data/` folder is the part that matters: a documented structure and one JSON schema. Copy it to another machine, back it up anywhere, or point the app at it with `INSPO_DATA_DIR`. Any other tool that reads JSON can use it too.
- **Extensible.** Because the data is just files plus a small HTTP API (`/api/gallery`, `/media/…`), the same folder could later be hosted on a remote server and the viewer pointed at it. That isn't built yet.

## How it works

Your capture document, a Claude Artifact whose link is `source_doc` in `data/gallery.json`, is the source of truth. In Claude (desktop or phone), add a link and a few words to it. Then add the item to the gallery in one of three ways:

1. **Fully automated.** Open Claude Code in this folder and ask it to complete the unfinished items. It downloads the media, looks at a few frames, writes the description and tags, adds the entry, and updates the document.
2. **Semi-automated.** Download the media yourself and drop it in `data/incoming/`, named or foldered by the item's ID (`di-043.mp4` or `di-043/…`). Then ask Claude Code to complete the items; it uses your files instead of downloading.
3. **Fully manual.** In the app, click **New entry** and upload files or attach them from `data/incoming/`.

Run the app to browse, search and watch everything.

## Setup

Requires Node.js 20+, pnpm and gpg.

```sh
pnpm i
pnpm tools install   # checks yt-dlp and ffmpeg for known vulnerabilities, verifies them, installs into tools/
pnpm dev             # http://localhost:5173
```

On macOS, install ffmpeg with `brew install ffmpeg`; `pnpm tools install` still checks it.

## Your data

The `data/` folder is self-contained:

```
data/
  gallery.json   every entry, category and tag (in git)
  media/         videos and images, named di-NNN-<slug>.<ext> (not in git; copy between machines)
    posters/     video thumbnails, regenerated automatically
  incoming/      drop folder for media not yet in the gallery (not in git)
```

`gallery.json` uses the `design-inspiration/v1` schema:

```jsonc
{
  "schema": "design-inspiration/v1",
  "next_id": "di-042",
  "source_doc": "https://claude.ai/artifact/…",   // the capture document
  "categories": [{ "id": "techniques", "name": "Techniques", "rule": "…" }],
  "tags": [{ "tag": "motion", "facet": "Technique" }],   // facet: Component | Technique | Theme | Use
  "entries": [{
    "id": "di-041", "added": "2026-11-08", "category": "techniques",
    "title": "…", "why": "…", "tags": ["motion"],
    "source": { "label": "someone on X", "url": "https://…" },
    "media": [{ "file": "media/di-041-slug.mp4", "type": "video" }]   // paths relative to data/
  }]
}
```

IDs are never reused. Tags must come from `tags`. Fields the app doesn't know are kept untouched.

- `pnpm check` validates the folder: IDs, tags, categories, and that every referenced file exists.
- `pnpm tools audit` re-checks the installed tools against current vulnerability reports.
