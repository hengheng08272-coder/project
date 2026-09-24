/**
 * Which of the three library shelves a file belongs on.
 *
 * The app stores three quite different things in the same places -- Telegram
 * episodes, saved links and plain uploads -- and until now the UI counted them
 * all as one number ("videos"). The Dashboard's media shelves split them, and
 * every source has to agree on what counts as a song or a picture, so the
 * decision lives here rather than being re-guessed per page.
 */
export type MediaKind = 'video' | 'audio' | 'image';

const EXTENSIONS: Record<MediaKind, string[]> = {
  video: ['mp4', 'mkv', 'webm', 'mov', 'avi', 'flv', 'ts', 'm4v', 'mpg', 'mpeg', '3gp', 'm3u8'],
  audio: ['mp3', 'm4a', 'wav', 'flac', 'aac', 'ogg', 'oga', 'opus', 'wma', 'mid'],
  image: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'avif', 'heic', 'tif', 'tiff'],
};

/** The extension of a filename, R2 key or URL -- query string and fragment stripped. */
export function extensionOf(source: string | null | undefined): string {
  if (!source) return '';
  const path = source.split(/[?#]/)[0];
  const dot = path.lastIndexOf('.');
  if (dot < 0 || dot === path.length - 1) return '';
  return path.slice(dot + 1).toLowerCase();
}

/**
 * Best guess at a file's kind from its mime type, falling back to its
 * extension. Anything unrecognizable counts as a video: that is what this app
 * overwhelmingly handles, and a mislabelled row is better on the busiest
 * shelf than hidden from every one of them.
 */
export function mediaKindOf(source: string | null | undefined, mimeType?: string | null): MediaKind {
  if (mimeType) {
    if (mimeType.startsWith('audio/')) return 'audio';
    if (mimeType.startsWith('image/')) return 'image';
    if (mimeType.startsWith('video/')) return 'video';
  }
  const ext = extensionOf(source);
  for (const kind of ['audio', 'image', 'video'] as MediaKind[]) {
    if (EXTENSIONS[kind].includes(ext)) return kind;
  }
  return 'video';
}

/** True when a URL points straight at a picture rather than a page or a video. */
export function isImageUrl(url: string | null | undefined): boolean {
  return EXTENSIONS.image.includes(extensionOf(url));
}
