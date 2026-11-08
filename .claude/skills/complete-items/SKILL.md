---
name: complete-items
description: Use when the user asks to complete, finish, sync or process unfinished inspiration items from their capture document (a Claude Artifact), mentions files they dropped in data/incoming/, or gives a link plus a few words to add. Prepares media (provided or downloaded), looks at frames, writes the entry to data/gallery.json, then updates the document.
---

# Complete unfinished items

The capture document (a Claude Artifact, edited through the Claude Docs connector) is the source of truth. Its link is `source_doc` in `data/gallery.json`. If that's missing (e.g. a fresh clone), ask the user for the link and record it with `pnpm -s entry source-doc <link>`. Privacy and tool rules in CLAUDE.md apply throughout.

1. **Read the document.** Load the docs skill, then read it: the index/instructions tab first (columns, category tabs, tag vocabulary, next ID, editing rules), then the category and inbox tabs. Follow the document's own rules for every edit you make to it.
2. **List the work** and show it to the user in one short list before starting:
   - rows whose ID is not in `data/gallery.json`;
   - rows with an empty Media cell whose source has media;
   - inbox rows without a "why";
   - gallery entries missing from the document (made with the app's New entry form).
   Also run `pnpm -s ingest --list` to see what the user dropped in `data/incoming/`. Ask which item each `unmatched` file belongs to (view it if that helps), then move it to `data/incoming/<id>/`.
   If the user gave a link and words directly, first add an inbox row to the document (its next ID, today's date), then treat it like the others.
3. **For each item:**
   1. `pnpm -s ingest <id> <url>` prints JSON. Files the user provided are used as-is; otherwise media is downloaded. The JSON includes the post author and text (X), each file's `path`, and absolute `view`/`frames` paths. A `note` means link-only (read a website's title/description with WebFetch).
   2. Look at the frames (or the images) with Read. Combine what you see with the user's words and the post text.
   3. Write `data/incoming/<id>/.frames/entry.json` and run `pnpm -s entry put data/incoming/<id>/.frames/entry.json`:
      - **id / added:** the document's.
      - **title:** 2–6 words.
      - **why:** the user's words first, then a plain description of what the clip shows.
      - **category:** a category id.
      - **tags:** 2–6 from the vocabulary; add `newTags` only for a genuinely new concept.
      - **source:** label `<handle> on X` or the domain.
      - **media:** the `incoming/…` paths in order, plus any `media/…` files the entry already has.
      The files move into `data/media/` and the item's incoming folder is removed. For a link-only item, put the JSON in a scratch location instead.
   4. Update the document: fill the row (title, why, tags, Media = the `media/…` filenames from the output). Move it from the inbox to the top of its category tab, and update counts, totals and the next ID as the document's rules say.
4. **Finish:** run `pnpm check` and reply with one line per item: ID, category, files.

Stop and ask the user when:
- an ID means different items in the document and the gallery;
- a tool is blocked by its audit;
- a download fails (e.g. a protected post): ask them to drop the file in `data/incoming/<id>/`, or leave the item link-only.
