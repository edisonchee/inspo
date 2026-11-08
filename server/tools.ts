// External tools (ffmpeg, yt-dlp): where they live, how they may be invoked, and the vulnerability audit
// that gates every use. Install them with `pnpm tools install`; nothing here downloads binaries.
import { execFile } from 'node:child_process';
import { existsSync, promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export type ToolName = 'ffmpeg' | 'yt-dlp';

export const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const TOOLS_DIR = path.join(ROOT, 'tools');
export const BIN_DIR = path.join(TOOLS_DIR, 'bin');
const AUDIT_CACHE = path.join(TOOLS_DIR, 'audit.json');
const ACCEPTED_FFMPEG_CVES = path.join(ROOT, 'security', 'ffmpeg-accepted-cves.json');

/** Generic client name for every request the tooling makes. Never add contact details or identity here. */
export const USER_AGENT = 'inspo-tools';

const EXE = process.platform === 'win32' ? '.exe' : '';

/** The repo-local binary if installed, else whatever is on PATH (still audited before use). */
export function toolPath(name: ToolName): string {
  const local = path.join(BIN_DIR, name + EXE);
  return existsSync(local) ? local : name;
}

/**
 * Input options for every ffmpeg run. Media comes from the internet, so ffmpeg may only read local files,
 * only in the containers and codecs X and the web actually use. Network protocols, playlists/manifests
 * (HLS, DASH, RTSP) and exotic decoders, where most ffmpeg CVEs live, are refused outright.
 */
export const FFMPEG_INPUT_GUARD = [
  '-protocol_whitelist', 'file',
  '-format_whitelist', 'mov,mp4,m4a,3gp,3g2,mj2,matroska,webm',
  '-codec_whitelist', 'h264,hevc,vp8,vp9,av1,mpeg4',
];

/**
 * Fixed options for every yt-dlp run. No config files or plugins (they could add cookies, --exec or
 * credentials), no cookies, no updates, no merging/fixups (so yt-dlp never invokes ffmpeg itself), a
 * single progressive MP4 when one exists, ASCII filenames and a size cap. Never add cookies, login,
 * --netrc*, --exec, --user-agent or extra headers: that is how identity leaks to the sites we visit.
 */
export const YTDLP_SAFE_ARGS = [
  '--ignore-config', '--no-plugin-dirs', '--no-cookies', '--no-cookies-from-browser', '--no-update', '--no-exec',
  '--fixup', 'never', '--format', 'best[ext=mp4][protocol^=http]/best[ext=mp4]/best',
  '--restrict-filenames', '--no-overwrites', '--no-mtime', '--max-filesize', '300M', '--socket-timeout', '30',
  '--write-info-json', '--no-write-comments', '--yes-playlist',
];

/** Upper bound for a single ffmpeg run; crafted files that loop or exhaust memory get killed. */
export const FFMPEG_TIMEOUT_MS = 60_000;

export function run(file: string, args: string[], timeout = FFMPEG_TIMEOUT_MS): Promise<string> {
  return new Promise((resolve, reject) =>
    execFile(file, args, { timeout, maxBuffer: 32 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) =>
      err ? reject(Object.assign(err, { stderr })) : resolve(`${stdout}${stderr}`),
    ),
  );
}

export async function toolVersion(name: ToolName, file = toolPath(name)): Promise<string | null> {
  try {
    const out = await run(file, name === 'ffmpeg' ? ['-hide_banner', '-version'] : ['--version'], 15_000);
    if (name === 'yt-dlp') return out.trim().split('\n')[0] || null;
    // "ffmpeg version 9.0.2-…", "n9.0.2-15-g…" (release-branch build) or "7.1.5-0+deb13u1".
    const m = /version n?(\d+\.\d+(?:\.\d+)?)/.exec(out);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

export interface Audit {
  tool: ToolName;
  version: string;
  ok: boolean;
  /** Known vulnerabilities affecting this version that are not accepted. */
  problems: string[];
  /** Known vulnerabilities accepted with a recorded reason (ffmpeg only). */
  accepted: string[];
  checkedAt: string;
}

async function getJson(url: string, init: RequestInit = {}): Promise<unknown> {
  const res = await fetch(url, {
    ...init,
    headers: { 'user-agent': USER_AGENT, ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

/** OSV.dev: advisories for an exact PyPI version. */
export async function osvVulns(pkg: string, version: string): Promise<string[]> {
  const d = (await getJson('https://api.osv.dev/v1/query', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ version, package: { name: pkg, ecosystem: 'PyPI' } }),
  })) as { vulns?: { id: string; aliases?: string[]; summary?: string }[] };
  return (d.vulns ?? []).map((v) => `${[v.id, ...(v.aliases ?? [])].join(' / ')}: ${v.summary ?? ''}`.trim());
}

/** NVD: CVEs whose configurations match this ffmpeg version. */
export async function nvdFfmpegCves(version: string): Promise<{ id: string; text: string }[]> {
  const url = `https://services.nvd.nist.gov/rest/json/cves/2.0?virtualMatchString=cpe:2.3:a:ffmpeg:ffmpeg:${version}&resultsPerPage=2000`;
  const d = (await getJson(url)) as { vulnerabilities?: { cve: { id: string; descriptions: { value: string }[] } }[] };
  return (d.vulnerabilities ?? []).map(({ cve }) => ({ id: cve.id, text: cve.descriptions[0]?.value ?? '' }));
}

async function acceptedFfmpegCves(): Promise<Map<string, string>> {
  const raw = JSON.parse(await fs.readFile(ACCEPTED_FFMPEG_CVES, 'utf8')) as { cves: { id: string; reason: string }[] };
  return new Map(raw.cves.map((c) => [c.id, c.reason]));
}

/** Check one tool version against the public databases. Throws if the databases can't be reached. */
export async function auditVersion(tool: ToolName, version: string): Promise<Audit> {
  const checkedAt = new Date().toISOString();
  if (tool === 'yt-dlp') {
    const problems = await osvVulns('yt-dlp', version);
    return { tool, version, ok: problems.length === 0, problems, accepted: [], checkedAt };
  }
  const accepted = await acceptedFfmpegCves();
  const cves = await nvdFfmpegCves(version);
  const problems = cves.filter((c) => !accepted.has(c.id)).map((c) => `${c.id}: ${c.text}`);
  const ok = problems.length === 0;
  return { tool, version, ok, problems, accepted: cves.filter((c) => accepted.has(c.id)).map((c) => c.id), checkedAt };
}

type Cache = Partial<Record<ToolName, Audit>>;
const DAY = 24 * 60 * 60 * 1000;

async function readCache(): Promise<Cache> {
  return JSON.parse(await fs.readFile(AUDIT_CACHE, 'utf8').catch(() => '{}')) as Cache;
}

/**
 * Audit the tool that would actually run. Results are cached for a day per version; if the databases
 * can't be reached, a passing result up to 7 days old is reused, otherwise the audit fails (closed).
 */
export async function audit(tool: ToolName, { fresh = false } = {}): Promise<Audit & { path: string }> {
  const file = toolPath(tool);
  const version = await toolVersion(tool, file);
  if (!version) {
    const why = file === tool ? 'not installed (run `pnpm tools install`)' : 'version could not be read';
    return { tool, version: '?', ok: false, problems: [`${tool} ${why}`], accepted: [], checkedAt: '', path: file };
  }
  const cache = await readCache();
  const hit = cache[tool];
  const age = hit ? Date.now() - Date.parse(hit.checkedAt) : Infinity;
  if (!fresh && hit?.version === version && age < DAY) return { ...hit, path: file };
  try {
    const result = await auditVersion(tool, version);
    await fs.mkdir(TOOLS_DIR, { recursive: true });
    await fs.writeFile(AUDIT_CACHE, JSON.stringify({ ...(await readCache()), [tool]: result }, null, 2) + '\n');
    return { ...result, path: file };
  } catch (err) {
    if (hit?.version === version && hit.ok && age < 7 * DAY) return { ...hit, path: file };
    const msg = `vulnerability databases unreachable (${(err as Error).message}); refusing to run ${tool} unaudited`;
    return { tool, version, ok: false, problems: [msg], accepted: [], checkedAt: '', path: file };
  }
}

/** Path of an audited, currently clean tool, or an error listing why it may not run. */
export async function requireSafe(tool: ToolName): Promise<string> {
  const a = await audit(tool);
  if (!a.ok) throw new Error(`${tool} ${a.version} blocked:\n  ${a.problems.join('\n  ')}`);
  return a.path;
}
