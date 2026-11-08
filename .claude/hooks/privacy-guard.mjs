#!/usr/bin/env node
// PreToolUse guard for Bash, WebFetch and WebSearch: blocks anything that could send the user's identity
// to a third party. Identifiers are read at runtime from this machine (git config, OS user, home path,
// hostname), so nothing personal is stored in the repo. Exit 2 blocks the call and tells Claude why.
import { execFileSync } from 'node:child_process';
import os from 'node:os';

const input = JSON.parse(await new Promise((resolve) => {
  let s = '';
  process.stdin.on('data', (c) => (s += c)).on('end', () => resolve(s || '{}'));
}));
const tool = input.tool_name ?? '';
const args = input.tool_input ?? {};
const projectDir = input.cwd ?? process.cwd();

function git(key) {
  try {
    return execFileSync('git', ['config', '--get', key], { encoding: 'utf8', cwd: projectDir }).trim();
  } catch {
    return '';
  }
}

const home = os.homedir();
const identifiers = [git('user.email'), git('user.name'), os.userInfo().username, os.hostname(), process.env.USER, process.env.USERNAME]
  .filter((v) => v && v.length >= 3)
  .map((v) => v.toLowerCase());
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;

function block(reason) {
  process.stderr.write(
    `Blocked by the privacy guard (.claude/hooks/privacy-guard.mjs): ${reason}\n` +
      'Never send the user\'s identity (email, name, username, cookies, credentials, home path) to any site. ' +
      'Use `pnpm ingest` for media, the Docs connector for the doc, and plain WebFetch reads for public pages.\n',
  );
  process.exit(2);
}

function leaks(text) {
  const t = text.toLowerCase();
  if (EMAIL.test(text)) return 'it contains an email address';
  const hit = identifiers.find((id) => t.includes(id));
  return hit ? 'it contains an identifier of this user or machine' : null;
}

if (tool === 'WebFetch' || tool === 'WebSearch') {
  const why = leaks(`${args.url ?? ''} ${args.query ?? ''}`);
  if (why) block(`this ${tool} request would send it: ${why}.`);
  process.exit(0);
}

if (tool === 'Bash') {
  const cmd = String(args.command ?? '');
  const NET = /\b(curl|wget|yt-dlp|gallery-dl|aria2c|httpie|http|nc|ncat|socat|telnet|ftp|sftp|scp|ssh|rsync)\b|\bfetch\(|https?:\/\//i;
  if (!NET.test(cmd)) process.exit(0);

  // Downloaders run only through `pnpm ingest` (fixed, audited arguments).
  // Command position only: line start, after ; & | ( or a quote, after sudo/env/…, or as a path (tools/bin/yt-dlp).
  const DOWNLOADER = /(^|[;&|(\n"'`]\s*|\/|\b(?:sudo|env|exec|nohup|xargs|time|command)\s+)(yt-dlp|gallery-dl|aria2c)(?=\s|$|["'])/m;
  if (DOWNLOADER.test(cmd)) block('run downloaders only through `pnpm ingest`.');

  // Requests that carry identity or credentials.
  const RISKY = /(^|\s)(-A|-H|-b|-c|-u|-d|-F|-e|--user-agent|--header|--cookie\S*|--user|--data\S*|--form|--referer|--netrc\S*|--add-headers?|--username|--password|--post-data|--load-cookies)(\s|=|$)/;
  if (/\b(curl|wget)\b/.test(cmd) && RISKY.test(cmd)) block('custom headers, user agents, cookies, credentials or uploads are not allowed.');

  // Identifiers anywhere outside local paths (the home path itself is fine as a file location).
  // Local paths (after start, space, =, quote or paren; never the `//` of a URL) are file locations, not payload.
  const withoutPaths = cmd.split(home).join(' ').replace(/(^|[\s='"(])(?:\.{0,2}|~)\/[^\s'"]*/g, '$1 ');
  const why = leaks(withoutPaths);
  if (why) block(`this network command would send it: ${why}.`);
}
process.exit(0);
