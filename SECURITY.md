# Security review

Reviewed 2026-11-08, then re-rated against a typical installation, and fixed. This is a personal, local-first tool; the review asks how it could be abused anyway.

## Environment assumed

- **One user.** No shared machine, no other accounts.
- **The app runs directly on the user's computer** (macOS or Linux), often a laptop that joins untrusted networks such as café or office Wi-Fi.
- **You browse the web on the same computer while the dev server runs.** That makes cross-site requests to `localhost` the realistic remote attack. Current Chrome and Edge also ask permission before a public site may call a local address (Local Network Access); Firefox and Safari don't yet.
- **Claude Code sessions process untrusted text** (posts, pages, the capture document) and may run in a mode that auto-approves commands.
- **`data/` is personal.** It is now fully gitignored.

## Method

- Code review of `server/`, `scripts/`, `.claude/` and the supply-chain tooling.
- Live probes against a dev server on a throwaway copy of `data/`, before and after the fixes:
  - cross-origin requests, Host-header rebinding and LAN access;
  - path traversal, symlinks, uploads and body size.
- The privacy guard fed exfiltration-shaped commands (not executed).
- A headless-browser regression run of the UI after the fixes (browse, search, keyboard, create with upload, edit, delete).
- `pnpm audit` (clean), plus OSV.dev/NVD audits of yt-dlp 2026.10.26 and ffmpeg 9.0.2.

## Findings

| # | Finding | First rating | Typical install | Status |
| --- | --- | --- | --- | --- |
| 1 | API without login listened on every interface | High | High | **Fixed** |
| 2 | Any website could create entries, add tags, upload files | High | Medium | **Fixed** |
| 3 | Uploaded SVGs served with scripts enabled | Medium | Low | **Fixed** |
| 4 | Privacy guard bypassable by prompt injection | Medium | Medium | **Hardened**; residual risk |
| 5 | No size limits on bodies or uploads | Medium | Low | **Fixed** |
| 6 | Symlinks followed out of `data/` | Medium | Low | **Fixed** |
| 7 | Tool binaries not hash-checked after install | Low | Info | Accepted |
| 8 | ffmpeg builds checksum-only; vulnerability data lags | Low | Low | Accepted |
| 9 | yt-dlp signing key pinned on first use | Low | Low | Accepted |
| 10 | `entry put` renamed files before validating paths | Low | Low | **Fixed** |
| 11 | CLI and server could overwrite each other's writes | Low | Info | Accepted |
| 12 | Third-party requests reveal your IP (Google Fonts) | Low | Low | Accepted (your choice of font) |
| 13 | Personal data committed to git | Info | Low | **Fixed** |

### 1. Exposure (High, fixed)

**Why it stays High:** on a laptop on shared Wi-Fi, anyone on that network could read and change the gallery while the server ran.

**Fix:** the server now listens on `127.0.0.1` by default. Reaching it from other devices is a per-machine opt-in: `INSPO_HOST=0.0.0.0` in the gitignored `.env.local`. With that set, the exposure returns, so use it only on a trusted network. If the app runs in a VM or container, point the port forward at `127.0.0.1` on the host side.

**Verified:** by default the server prints only `127.0.0.1`, and the network address refuses connections.

### 2. Cross-site request forgery (High → Medium, fixed)

**Why lower:** Chromium-based browsers now ask before a public site may call `localhost`. It's still real in browsers without that prompt, and a single granted prompt re-opens it.

**Fix:** `/api` refuses requests whose `Sec-Fetch-Site` isn't `same-origin`/`none` or whose `Origin` doesn't match the host (403). JSON routes require `Content-Type: application/json` (415). Uploads require an `X-Inspo-Upload: 1` header (400), which a browser can't send cross-site without a preflight the server never grants.

**Verified:** cross-origin POST, GET and upload → 403. A `text/plain` POST → 415. An upload without the header → 400. The UI still creates, uploads, edits and deletes normally.

### 3. Scripted SVG (Medium → Low, fixed)

**Why lower:** with 2 fixed, a malicious SVG would have to be added by you, and then opened directly.

**Fix:** every `/media` and `/incoming` response carries a `sandbox` Content-Security-Policy and `X-Content-Type-Options: nosniff`, so scripts in a file never run, even when opened directly.

### 4. Privacy guard bypass (Medium, hardened)

**Why unchanged:** sessions handle untrusted text and may auto-approve commands, so a prompt injection is plausible.

**Hardening:** the guard now also blocks:
- `curl -T`/`--upload-file` and other upload flags;
- command substitution (`$(…)`, backticks) inside network commands;
- inline scripts that use network APIs (`node -e`, `python -c`, …);
- `git push` to an explicit URL;
- identifiers hidden with URL or base64 encoding in WebFetch/WebSearch.

**Verified:** all six earlier bypasses are now blocked, and the 16 regression cases still pass.

**Residual:** it's still a text-pattern check. A script file written first and then run, or a tool it doesn't know, can get past it. Real containment is Claude Code's sandbox with a network allowlist, plus permission prompts for anything off the allow list. Use both for sessions that process untrusted links.

### 5. Size limits (Medium → Low, fixed)

**Why lower:** after 1 and 2, only local callers reach the API.

**Fix:** JSON bodies are capped at 1 MB and uploads at 500 MB (413 beyond that).

### 6. Symlinks (Medium → Low, fixed)

**Why lower:** a symlink only gets into `data/` through your own actions, e.g. extracting an archive into `incoming/`.

**Fix:** files are served only if their real path is inside `media/` or `incoming/`. The store, `ingest` and `entry put` refuse symlinks.

**Verified:** a symlink in `incoming/` pointing outside `data/` → 403, and it isn't listed as attachable.

### 7. Tool binaries not re-verified (Low → Info, accepted)

Swapping a binary in `tools/bin/` requires write access to your account. Someone with that could equally edit the app's code, so a hash check adds little.

### 8. ffmpeg provenance and vulnerability lag (Low, accepted)

BtbN builds have a checksum but no independent signature, NVD lags new CVEs, and the accepted-CVE list is a judgement call. Mitigated by:
- ffmpeg 9.0.2 (current upstream);
- an input guard limiting it to local files, four container formats and six video codecs;
- a 60 s timeout;
- now, no cross-site uploads (2).

Optional extra: run ffmpeg under an OS sandbox with no network.

### 9. Signing key pinned on first use (Low, accepted)

The yt-dlp key was fetched once from the yt-dlp repository and pinned by fingerprint (`AC0C BBE6 848D 6A87 3464 AF4E 57CF 6593 3B5A 7581`). Cross-checking it against a keyserver is a manual one-off.

### 10. `entry put` path order (Low, fixed)

Every `incoming/…` path is now checked before any file is renamed: it must be a regular file inside `data/incoming/`.

### 11. Cross-process write race (Low → Info, accepted)

One user rarely runs the CLI and saves in the app at the same instant. Both write atomically, so the file is never corrupted; at worst one change is lost.

### 12. Third-party requests (Low, accepted)

- Google Fonts (Inter) sees your IP address on each app load. Self-host the font if that matters.
- Source sites (X, `twimg.com`) see your IP address during `ingest`; they never see any identity.

### 13. Personal data in git (fixed)

`data/` is gitignored entirely, and a fresh clone starts with an empty gallery. `data/gallery.json` was removed from every commit with a history rewrite; no commit contains any file under `data/`.

## Controls in place

- **Network:**
  - localhost by default;
  - cross-site requests refused; JSON-only bodies and an upload header;
  - size caps; a sandboxing CSP on media;
  - no symlinks out of `data/`;
  - a Host check against DNS rebinding;
  - path traversal blocked.
- **Data:** writes validated against `schema/inspo-v1.schema.json` (ajv) plus cross-reference checks, written atomically. Media is never deleted. `data/` is never in git.
- **Supply chain:**
  - yt-dlp and ffmpeg audited (OSV.dev/NVD) before download, GPG/SHA-256 verified, and re-audited before every use (24 h cache, fails closed);
  - npm packages vetted with `pnpm tools vet`, pinned exactly, `pnpm audit`ed;
  - only `esbuild` may run install scripts.
- **Tools at run time:**
  - ffmpeg limited to local files and common formats and codecs, with a timeout;
  - yt-dlp with fixed arguments (no config, plugins, cookies, `--exec` or self-update).
- **Identity:**
  - every request uses the generic `inspo-tools` user agent;
  - identifiers are read at runtime and never stored;
  - the privacy guard runs on every shell command and web request;
  - browser-control tools, raw downloaders and package installs are denied.
