// pnpm tools install   download, verify and install yt-dlp + ffmpeg into tools/bin/ (gitignored)
// pnpm tools audit     re-check the installed versions against OSV.dev / NVD now
// pnpm tools status    cached one-line check per tool (used by the SessionStart hook)
// pnpm tools vet <npm-package>[@version]   check a package (and its direct dependencies) on OSV.dev BEFORE
//                      adding it; after `pnpm add`, `pnpm audit` covers the whole tree
//
// Order of operations for each tool: look up the release → audit that version against the public
// vulnerability databases → download → verify (yt-dlp: GPG signature with the pinned key + SHA-256;
// ffmpeg: SHA-256) → install. Nothing is executed before it has been audited and verified.
import { createHash } from 'node:crypto';
import { createWriteStream, existsSync, promises as fs } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { BIN_DIR, ROOT, TOOLS_DIR, USER_AGENT, audit, auditVersion, getJson, osvVulns, run, toolVersion, type ToolName } from '../server/tools.ts';

const YTDLP_KEY = path.join(ROOT, 'security', 'yt-dlp-signing-key.asc');
/** Fingerprint of the pinned key file; a changed key file is refused. */
const YTDLP_KEY_FINGERPRINT = 'AC0CBBE6848D6A873464AF4E57CF65933B5A7581';
const EXE = process.platform === 'win32' ? '.exe' : '';
const TMP = path.join(TOOLS_DIR, 'tmp');

interface Release {
  tag_name: string;
  assets: { name: string; browser_download_url: string }[];
}

async function github<T>(p: string): Promise<T> {
  const res = await fetch(`https://api.github.com/${p}`, {
    headers: { 'user-agent': USER_AGENT, accept: 'application/vnd.github+json' },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`GitHub ${p}: HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

async function download(url: string, to: string): Promise<void> {
  const res = await fetch(url, { headers: { 'user-agent': USER_AGENT }, signal: AbortSignal.timeout(10 * 60_000) });
  if (!res.ok || !res.body) throw new Error(`download ${url}: HTTP ${res.status}`);
  await pipeline(Readable.fromWeb(res.body as never), createWriteStream(to));
}

async function sha256(file: string): Promise<string> {
  const h = createHash('sha256');
  await pipeline((await fs.open(file)).createReadStream(), h);
  return h.digest('hex');
}

function expectedHash(sums: string, name: string): string {
  for (const line of sums.split('\n')) {
    const [hash, file] = line.trim().split(/\s+\*?/);
    if (file === name) return hash.toLowerCase();
  }
  throw new Error(`no checksum listed for ${name}`);
}

function asset(rel: Release, name: string) {
  const a = rel.assets.find((x) => x.name === name);
  if (!a) throw new Error(`release ${rel.tag_name} has no asset ${name}`);
  return a.browser_download_url;
}

function report(tool: ToolName, version: string, a: { ok: boolean; problems: string[]; accepted: string[] }) {
  if (a.ok) {
    const acc = a.accepted.length ? ` (${a.accepted.length} reviewed CVEs accepted, see security/ffmpeg-accepted-cves.json)` : '';
    console.log(`✓ ${tool} ${version}: no unaccepted known vulnerabilities${acc}`);
  } else {
    console.error(`✗ ${tool} ${version}: refused\n  ${a.problems.join('\n  ')}`);
  }
}

async function verifySignature(sums: string, sig: string): Promise<void> {
  const home = await fs.mkdtemp(path.join(TMP, 'gpg-'));
  try {
    await run('gpg', ['--homedir', home, '--batch', '--quiet', '--import', YTDLP_KEY]);
    const keys = await run('gpg', ['--homedir', home, '--batch', '--with-colons', '--list-keys']);
    const fprs = keys.split('\n').filter((l) => l.startsWith('fpr:')).map((l) => l.split(':')[9]);
    if (!fprs.includes(YTDLP_KEY_FINGERPRINT)) throw new Error('pinned yt-dlp key file does not match its fingerprint');
    await run('gpg', ['--homedir', home, '--batch', '--verify', sig, sums]);
  } finally {
    await fs.rm(home, { recursive: true, force: true });
  }
}

async function installYtDlp(): Promise<boolean> {
  const binName =
    process.platform === 'win32' ? 'yt-dlp.exe'
    : process.platform === 'darwin' ? 'yt-dlp_macos'
    : process.arch === 'arm64' ? 'yt-dlp_linux_aarch64' : 'yt-dlp_linux';
  const rel = await github<Release>('repos/yt-dlp/yt-dlp/releases/latest');
  const version = rel.tag_name;
  const target = path.join(BIN_DIR, 'yt-dlp' + EXE);
  if ((await toolVersion('yt-dlp', target)) === version) {
    console.log(`= yt-dlp ${version} already installed`);
    return true;
  }

  const a = await auditVersion('yt-dlp', version);
  report('yt-dlp', version, a);
  if (!a.ok) return false;

  const files = { bin: path.join(TMP, binName), sums: path.join(TMP, 'SHA2-256SUMS'), sig: path.join(TMP, 'SHA2-256SUMS.sig') };
  await download(asset(rel, binName), files.bin);
  await download(asset(rel, 'SHA2-256SUMS'), files.sums);
  await download(asset(rel, 'SHA2-256SUMS.sig'), files.sig);

  try {
    await verifySignature(files.sums, files.sig);
    console.log('✓ yt-dlp checksums signed by the pinned yt-dlp release key');
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code !== 'ENOENT' || !process.argv.includes('--allow-unsigned')) {
      throw new Error(
        e.code === 'ENOENT'
          ? 'gpg is not installed, so the yt-dlp signature cannot be checked. Install gpg, or rerun with --allow-unsigned to rely on the SHA-256 checksum alone.'
          : `yt-dlp signature check failed: ${e.message}`,
      );
    }
    console.warn('! gpg missing: skipping the signature check (--allow-unsigned); relying on SHA-256 only');
  }
  const want = expectedHash(await fs.readFile(files.sums, 'utf8'), binName);
  if ((await sha256(files.bin)) !== want) throw new Error(`yt-dlp ${binName}: SHA-256 mismatch`);
  console.log('✓ yt-dlp binary matches its signed SHA-256');

  await fs.rename(files.bin, target);
  await fs.chmod(target, 0o755);
  const got = await toolVersion('yt-dlp', target);
  if (got !== version) throw new Error(`installed yt-dlp reports ${got}, expected ${version}`);
  console.log(`+ yt-dlp ${version} → ${path.relative(ROOT, target)}`);
  return true;
}

/** BtbN/FFmpeg-Builds platform name, or null where we don't download (macOS: use Homebrew). */
function ffmpegPlatform(): string | null {
  if (process.platform === 'linux') return process.arch === 'arm64' ? 'linuxarm64' : process.arch === 'x64' ? 'linux64' : null;
  if (process.platform === 'win32' && process.arch === 'x64') return 'win64';
  return null;
}

/** Highest n<major>.<minor>.<patch> release tag upstream; a release-branch build contains at least this. */
async function latestFfmpegTag(major: number, minor: number): Promise<string> {
  const tags = await github<{ name: string }[]>('repos/FFmpeg/FFmpeg/tags?per_page=100');
  const patches = tags
    .map((t) => new RegExp(`^n${major}\\.${minor}(?:\\.(\\d+))?$`).exec(t.name))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => Number(m[1] ?? 0));
  if (!patches.length) throw new Error(`no upstream ffmpeg tag n${major}.${minor}.x found`);
  return `${major}.${minor}.${Math.max(...patches)}`;
}

async function installFfmpeg(): Promise<boolean> {
  const plat = ffmpegPlatform();
  if (!plat) {
    console.log('· ffmpeg: no verified download for this platform; install it with your package manager (macOS: `brew install ffmpeg`).');
    const a = await audit('ffmpeg', { fresh: true });
    report('ffmpeg', a.version, a);
    return a.ok;
  }

  const rel = await github<Release>('repos/BtbN/FFmpeg-Builds/releases/latest');
  const ext = plat === 'win64' ? 'zip' : 'tar.xz';
  const builds = rel.assets
    .map((a) => ({ a, m: new RegExp(`^ffmpeg-n(\\d+)\\.(\\d+)-latest-${plat}-gpl-\\d+\\.\\d+\\.${ext.replace('.', '\\.')}$`).exec(a.name) }))
    .filter((x): x is { a: Release['assets'][number]; m: RegExpExecArray } => x.m !== null)
    .sort((x, y) => Number(y.m[1]) - Number(x.m[1]) || Number(y.m[2]) - Number(x.m[2]));
  if (!builds.length) throw new Error(`BtbN release ${rel.tag_name} has no ${plat} release build`);
  const { a: build, m } = builds[0];
  const minVersion = await latestFfmpegTag(Number(m[1]), Number(m[2]));

  const target = path.join(BIN_DIR, 'ffmpeg' + EXE);
  const installed = await toolVersion('ffmpeg', target);
  if (installed && installed === minVersion) {
    console.log(`= ffmpeg ${installed} already installed`);
    return (await audit('ffmpeg')).ok;
  }

  const pre = await auditVersion('ffmpeg', minVersion);
  report('ffmpeg', minVersion, pre);
  if (!pre.ok) return false;

  const archive = path.join(TMP, build.name);
  const sums = path.join(TMP, 'checksums.sha256');
  await download(build.browser_download_url, archive);
  await download(asset(rel, 'checksums.sha256'), sums);
  if ((await sha256(archive)) !== expectedHash(await fs.readFile(sums, 'utf8'), build.name)) {
    throw new Error(`${build.name}: SHA-256 mismatch`);
  }
  console.log(`✓ ${build.name} matches the release's SHA-256`);

  const out = path.join(TMP, 'ffmpeg-extract');
  await fs.rm(out, { recursive: true, force: true });
  await fs.mkdir(out, { recursive: true });
  await run('tar', ['-xf', archive, '-C', out], 5 * 60_000);
  const dir = (await fs.readdir(out))[0];
  const bin = path.join(out, dir, 'bin', 'ffmpeg' + EXE);
  if (!existsSync(bin)) throw new Error(`ffmpeg binary missing from ${build.name}`);
  await fs.rename(bin, target);
  await fs.chmod(target, 0o755);

  const a = await audit('ffmpeg', { fresh: true });
  report('ffmpeg', a.version, a);
  if (!a.ok) {
    await fs.rm(target, { force: true });
    return false;
  }
  console.log(`+ ffmpeg ${a.version} → ${path.relative(ROOT, target)}`);
  return true;
}

async function main() {
  const cmd = process.argv[2] ?? 'audit';
  if (cmd === 'vet') {
    const spec = process.argv[3];
    if (!spec) throw new Error('usage: pnpm tools vet <npm-package>[@version]');
    const at = spec.lastIndexOf('@');
    const [name, wanted] = at > 0 ? [spec.slice(0, at), spec.slice(at + 1)] : [spec, 'latest'];
    const meta = (await getJson(`https://registry.npmjs.org/${name.replace('/', '%2F')}/${wanted}`)) as {
      version: string;
      dependencies?: Record<string, string>;
    };
    let ok = true;
    const check = async (pkg: string, version: string, indent = '') => {
      const vulns = await osvVulns(pkg, version, 'npm');
      console.log(`${indent}${vulns.length ? '✗' : '✓'} ${pkg}@${version}${vulns.length ? `\n${indent}  ${vulns.join(`\n${indent}  `)}` : ''}`);
      ok &&= vulns.length === 0;
    };
    await check(name, meta.version);
    for (const dep of Object.keys(meta.dependencies ?? {})) {
      const d = (await getJson(`https://registry.npmjs.org/${dep.replace('/', '%2F')}/latest`)) as { version: string };
      await check(dep, d.version, '  ');
    }
    console.log(ok ? `→ ok to add: pnpm add ${name}@${meta.version}, then pnpm audit` : '→ do not add');
    process.exit(ok ? 0 : 1);
  }
  if (cmd === 'status') {
    // Quiet, cached check for session start: one line per tool.
    for (const tool of ['yt-dlp', 'ffmpeg'] as const) {
      const a = await audit(tool);
      console.log(a.ok ? `${tool} ${a.version}: ok` : `${tool}: BLOCKED (${a.problems[0]}); run \`pnpm tools install\` or tell the user`);
    }
    process.exit(0);
  }
  if (cmd === 'audit') {
    let ok = true;
    for (const tool of ['yt-dlp', 'ffmpeg'] as const) {
      const a = await audit(tool, { fresh: true });
      report(tool, a.version, a);
      if (a.ok) console.log(`  using ${a.path === tool ? `${tool} from PATH` : path.relative(ROOT, a.path)}`);
      ok &&= a.ok;
    }
    process.exit(ok ? 0 : 1);
  }
  if (cmd === 'install') {
    await fs.mkdir(BIN_DIR, { recursive: true });
    await fs.mkdir(TMP, { recursive: true });
    try {
      const results = [await installYtDlp(), await installFfmpeg()];
      process.exit(results.every(Boolean) ? 0 : 1);
    } finally {
      await fs.rm(TMP, { recursive: true, force: true });
    }
  }
  console.error('usage: pnpm tools <install|audit|status|vet>');
  process.exit(2);
}

main().catch((err) => {
  console.error(`✗ ${(err as Error).message}`);
  process.exit(1);
});
