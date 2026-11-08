/** URL the browser uses for a media file (paths in gallery.json are relative to data/). */
export function mediaUrl(file: string): string {
  return `/${file.split('/').map(encodeURIComponent).join('/')}`;
}

/** `media/di-041-x.mp4` → `media/posters/di-041-x.jpg` */
export function posterFile(file: string): string {
  const name = file.slice(file.lastIndexOf('/') + 1).replace(/\.[^.]+$/, '');
  return `media/posters/${name}.jpg`;
}

export function domain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

const VIDEO_EXT = /\.(mp4|webm|mov|m4v|ogv)$/i;
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif|svg)$/i;

export function mediaTypeFor(name: string): 'video' | 'image' | null {
  if (VIDEO_EXT.test(name)) return 'video';
  if (IMAGE_EXT.test(name)) return 'image';
  return null;
}
