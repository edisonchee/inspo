# Security review

Reviewed 2026-11-08 against the repository at commit `53cfefe` plus the working tree. This is a personal, local-first tool; the review asks how it could be abused anyway.

## Method

- Code review of the server (`server/`), scripts (`scripts/`), the Claude Code harness (`.claude/`) and the supply-chain tooling.
- Live probes against a dev server running on a throwaway copy of `data/` (cross-origin requests, Host-header rebinding, LAN access, path traversal, uploads).
- The privacy guard tested with exfiltration-shaped commands (fed to the hook, not executed).
- `pnpm audit` (no known vulnerabilities), plus OSV.dev/NVD audits of yt-dlp 2026.10.26 and ffmpeg 9.0.2.

## What's worth protecting

| Asset | Why it matters |
| --- | --- |
| `data/gallery.json`, `data/media/` | The collection itself. Losing or silently altering it is the main harm. |
| The user's identity | Email, name, username, cookies. The harness is meant never to send them to a site. |
| The machine | Anything that runs code: ffmpeg on untrusted video, yt-dlp, Claude Code with shell access. |
| The capture document | Edited by Claude Code through the Docs connector. |

## Findings

| # | Severity | Finding | Status |
| --- | --- | --- | --- |
| 1 | **High** | API has no authentication and listens on every network interface | Confirmed |
| 2 | **High** | Any website can create entries, add tags and upload files (cross-site request forgery) | Confirmed |
| 3 | Medium | Uploaded SVGs are served from the app's origin with scripts enabled | Confirmed |
| 4 | Medium | Privacy guard is a text heuristic; a prompt injection can get data past it | Confirmed |
| 5 | Medium | No size limits on request bodies or uploads | Code review |
| 6 | Medium | Symlinks in `data/` are followed when serving and attaching files | Code review |
| 7 | Low | Installed tool binaries aren't hash-checked after install | Code review |
| 8 | Low | ffmpeg builds are checksum-only, and vulnerability data lags | Design |
| 9 | Low | yt-dlp signing key was pinned on first use | Design |
| 10 | Low | `entry put` renames a file before validating its path | Code review |
| 11 | Low | CLI and server can overwrite each other's writes | Code review |
| 12 | Low | Third-party requests reveal your IP (Google Fonts on every load) | Design |
| 13 | Info | What a public repo would expose | Design |

### 1. Unauthenticated API on all interfaces (High)

`vite.config.ts` sets `host: true` for both `dev` and `preview`, so the server binds to every network interface. There's no authentication. Probe from the LAN address: `GET http://<lan-ip>:5173/api/gallery` → **200** with the full gallery.

**Abuse:** anyone on the same network (café or office Wi-Fi) can do all of the following:
- read the collection;
- create, edit and delete entries;
- upload files, which also makes the server run ffmpeg on them (see 2);
- read anything in `data/media/` and `data/incoming/`.

**Fix:** bind to `127.0.0.1` by default and make LAN access an explicit opt-in (e.g. `INSPO_HOST=0.0.0.0`). If LAN access is kept, require a per-session token (printed at startup, sent as a header by the client) on every `/api` and media request.

### 2. Cross-site request forgery on POST routes (High)

The API accepts `text/plain` bodies and doesn't check `Origin`, so a browser sends these from any website without a CORS preflight. Probes with `Origin: https://evil.example`:
- `POST /api/tags` (text/plain) → **201**, tag created.
- `POST /api/entries/di-001/media?name=evil.svg` (text/plain) → **201**, file stored and attached.

PUT and DELETE need a preflight, which the server answers without `Access-Control-Allow-Origin`, so browsers block those. Cross-origin reads are blocked the same way, and Vite's host check stops DNS rebinding (`Host: evil.example` → 403).

**Abuse:** while `pnpm dev` is running, any page you visit can add junk entries, fill the disk, or upload a crafted `.mp4`. The server then runs ffmpeg on that file to make a poster. That turns any website into a delivery path for an ffmpeg exploit. The input guard and timeout (see Controls) shrink this surface but don't remove it.

**Fix:** reject `/api` requests whose `Origin` (or `Sec-Fetch-Site`) isn't the app's own. Require `Content-Type: application/json` for JSON routes and a custom header (e.g. `X-Inspo: 1`) on uploads; both force a preflight. The token from 1 also closes this.

### 3. Scripted SVG served from the app's origin (Medium)

`.svg` counts as an image, and `/media/*` serves it as `image/svg+xml` with no `Content-Security-Policy`. Probe: an SVG with `onload="fetch('/api/gallery')"` was uploaded cross-site (finding 2) and served back unchanged.

**Abuse:** inside the gallery (`<img>`) the script doesn't run. Opening the file directly ("Open image in new tab", or a link) runs it on the app's origin, where it can call PUT and DELETE. Deleted entries are recoverable from git, but edits can be subtle.

**Fix:** send `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; sandbox` and `X-Content-Type-Options: nosniff` on every `/media` and `/incoming` response. Alternatively, drop SVG from accepted media types, or serve it as an attachment.

### 4. Privacy guard is bypassable by design (Medium)

`.claude/hooks/privacy-guard.mjs` matches command text against identifiers read at runtime. It reliably catches accidents: an email in a User-Agent, cookies, a direct yt-dlp call (16/16 test cases). But these all **passed**:
- `curl -T <file>` uploads;
- `$(…)` command substitution that builds the identifier at run time;
- Python or Node one-liners that fetch;
- base64-encoded identifiers in a WebFetch URL;
- `git push` to a new remote.

**Abuse:** a post's text, a fetched page or a document edit containing instructions (prompt injection) could steer the agent into such a command. The skill tells Claude to treat that content as data, which helps but isn't a guarantee.

**Fix:** treat the guard as a seatbelt, not a wall. Real containment is:
- **Claude Code's sandbox** with a network allowlist limited to `x.com`, `twimg.com`, `video.twimg.com`, `api.osv.dev`, `services.nvd.nist.gov`, `api.github.com`, GitHub release hosts, `registry.npmjs.org` and `claude.ai`;
- **permission prompts for any command outside the allow list**, i.e. not running the harness in a mode that auto-approves shell commands.

Also add `-T`/`--upload-file` and `git push` to the guard's blocked patterns.

### 5. No size limits (Medium)

`readJson` buffers the whole body and `uploadMedia` streams without a cap. Through 1 or 2, a large body exhausts memory or disk.

**Fix:** cap JSON bodies (e.g. 1 MB) and uploads (e.g. 500 MB, matching yt-dlp's `--max-filesize 300M` plus headroom); return 413.

### 6. Symlinks followed (Medium)

`serveFile` checks the *path string* against `data/media/` or `data/incoming/`, then `fs.stat`/`createReadStream` follow symlinks. Attaching a file moves the link itself.

**Abuse:** a symlink that lands in the drop folder is served over the API and readable from the LAN (1). For example, an archive extracted into `data/incoming/` containing `di-043.png → ~/.ssh/id_ed25519`.

**Fix:** `lstat` and refuse symlinks in `listIncoming`, `resolveMedia` and `serveFile`. Or compare `fs.realpath` against the data root.

### 7. Tool binaries not re-verified after install (Low)

`requireSafe()` audits the *version string* the binary prints. Something that can already write to `tools/bin/` could swap in a trojan that prints the expected version.

**Fix:** record each binary's SHA-256 in `tools/audit.json` at install and compare it before every run.

### 8. ffmpeg provenance and vulnerability lag (Low)

- BtbN builds are verified only by a checksum published in the same GitHub release; there's no independent signature. The release is the moving `latest` tag.
- NVD lags new CVEs by days to weeks. `security/ffmpeg-accepted-cves.json` is a manual judgement.
- ffmpeg runs with the user's full privileges.

**Fix:** keep the input guard (it removes network protocols and exotic demuxers and decoders, where most ffmpeg CVEs live) and the timeout. Optionally run ffmpeg and yt-dlp under an OS sandbox (bubblewrap/firejail on Linux, `sandbox-exec` on macOS) with no network for ffmpeg and write access only to the item folder.

### 9. Trust-on-first-use signing key (Low)

`security/yt-dlp-signing-key.asc` was fetched from the yt-dlp repository once and pinned by fingerprint. If that fetch had been tampered with, the pin would protect the wrong key.

**Fix:** cross-check the fingerprint `AC0C BBE6 848D 6A87 3464 AF4E 57CF 6593 3B5A 7581` against a second channel (a keyserver, or a past release's signature) and note the result next to the key.

### 10. `entry put` renames before validating (Low)

For `incoming/…` paths, `scripts/entry.ts` renames the file to its title slug before the store rejects bad paths. `incoming/../../x` therefore renames a file outside `data/` and then moves it back.

**Fix:** resolve the path and require it to stay inside `data/incoming/` before any rename.

### 11. Cross-process write race (Low, integrity)

The store serialises writes within one process. `pnpm entry put` while the dev server is saving can lose one of the two updates; both write atomically, so the file is never corrupt.

**Fix:** a lock file (`data/.gallery.lock`) around read-modify-write, or route CLI writes through the running server when it's up.

### 12. Third-party requests (Low, privacy)

- Every page load fetches Inter from Google Fonts, which gives Google your IP address and user agent.
- `ingest` necessarily contacts X (`cdn.syndication.twimg.com`, `pbs.twimg.com`, `video.twimg.com`) and other source sites with the generic `inspo-tools` user agent; they see your IP address.

**Fix:** self-host Inter (vet the package first with `pnpm tools vet`). Use a VPN if source sites seeing your IP matters.

### 13. If the repository is public (Info)

Visibility couldn't be checked from here. If the repository is public, it exposes:
- `data/gallery.json`: every entry, the tag vocabulary including personal ones (e.g. a tag for your own site), and the capture document's link (`source_doc`). That link still requires claude.ai access and the document's sharing settings.
- The commit author email in git history. GitHub's `noreply` address avoids this for future commits.

Media, tools and local settings are gitignored. No secrets, tokens or credentials are committed.

## Controls already in place

- **Supply chain:**
  - yt-dlp and ffmpeg are audited on OSV.dev/NVD *before* download and installed only after GPG and SHA-256 checks. They are re-audited before every use (cached 24 h, failing closed).
  - New npm packages are checked with `pnpm tools vet`, pinned exactly, then `pnpm audit`ed.
  - Lockfile committed; only `esbuild` may run install scripts.
- **ffmpeg hardening:** local files only, mov/mp4/matroska/webm, six video codecs, 60 s timeout. Debian's ffmpeg 7.1.5 is refused (34 unaccepted CVEs).
- **yt-dlp hardening:**
  - fixed arguments: no config files, plugins, cookies, `--exec` or self-update;
  - restricted filenames and a size cap;
  - no generic page scraping.
- **Identity:**
  - every request uses the generic `inspo-tools` user agent;
  - identifiers are read at runtime, never stored;
  - browser-control tools, raw downloaders and package installs are denied in `.claude/settings.json`.
- **Web app:**
  - path traversal blocked (`..%2f` → 403);
  - React escapes all text, and source URLs must be http(s);
  - Host-header check blocks DNS rebinding;
  - cross-origin reads, PUT and DELETE are blocked by the browser;
  - all writes are schema-validated (ajv) and atomic, and media is never deleted.

## Recommended order of fixes

1. Bind to `127.0.0.1` by default (1). This is a one-line change that removes most network exposure.
2. Origin / content-type / custom-header checks on `/api` (2), plus body and upload limits (5).
3. CSP `sandbox` + `nosniff` on media responses (3); refuse symlinks (6); path check in `entry put` (10).
4. Run the harness with Claude Code's sandbox and a network allowlist, and keep permission prompts on (4).
5. Hash-pin installed tools (7) and self-host the font (12).
