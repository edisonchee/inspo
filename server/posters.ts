import { promises as fs } from 'node:fs';
import path from 'node:path';
import { FFMPEG_INPUT_GUARD, requireSafe, run } from './tools.ts';

let warned = '';

/**
 * Grab a frame at ~1 s (or the first frame for shorter clips) as a JPEG. Never throws.
 * Runs only an audited ffmpeg, restricted to local video files (see server/tools.ts).
 */
export async function makePoster(video: string, poster: string): Promise<boolean> {
  let ffmpeg: string;
  try {
    ffmpeg = await requireSafe('ffmpeg');
  } catch (err) {
    const msg = (err as Error).message;
    if (warned !== msg) console.warn(`[inspo] skipping video posters: ${msg}`);
    warned = msg;
    return false;
  }
  await fs.mkdir(path.dirname(poster), { recursive: true });
  const grab = (seek: string) =>
    run(ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', '-ss', seek, ...FFMPEG_INPUT_GUARD, '-i', video, '-frames:v', '1', '-q:v', '3', poster]);
  const size = async () => (await fs.stat(poster).catch(() => null))?.size ?? 0;
  try {
    await grab('1');
    if (!(await size())) await grab('0');
    return (await size()) > 0;
  } catch (err) {
    console.warn(`[inspo] poster failed for ${video}:`, (err as Error).message);
    return false;
  }
}
