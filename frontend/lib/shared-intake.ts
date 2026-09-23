/**
 * Web Share Target hand-off.
 *
 * Android/Chromium (and an installed desktop PWA) let the system share sheet
 * send a photo or a link straight to us: the service worker takes the POST,
 * stashes the payload in a cache the page can read, and redirects to the
 * wardrobe with `?add=1&shared=1`. iOS has no share target at all, so nothing
 * here ever runs there — the UI says so instead of pretending.
 *
 * The stash is read once and deleted, so a reload does not re-open the dialog
 * with a garment the user already added.
 */

export const SHARE_CACHE = 'miaurmario-share';
export const SHARE_META_URL = '/__shared__/payload.json';
export const SHARE_FILE_URL = '/__shared__/image';

export interface SharedIntake {
  file: File | null;
  link: string | null;
  title: string | null;
}

interface SharedPayload {
  title?: string;
  text?: string;
  url?: string;
  hasImage?: boolean;
  name?: string;
  type?: string;
}

const URL_IN_TEXT = /https?:\/\/[^\s"'<>]+/i;

/** Share sheets often bundle the link inside the text ("Mira esto https://…"). */
export function firstUrlIn(...values: (string | undefined | null)[]): string | null {
  for (const value of values) {
    if (!value) continue;
    const match = value.match(URL_IN_TEXT);
    if (match) return match[0];
  }
  return null;
}

/** Read and consume whatever the share target stashed, if anything. */
export async function readSharedIntake(): Promise<SharedIntake | null> {
  if (typeof caches === 'undefined') return null;

  try {
    const cache = await caches.open(SHARE_CACHE);
    const metaResponse = await cache.match(SHARE_META_URL);
    if (!metaResponse) return null;

    const meta = (await metaResponse.json()) as SharedPayload;
    let file: File | null = null;
    if (meta.hasImage) {
      const fileResponse = await cache.match(SHARE_FILE_URL);
      if (fileResponse) {
        const blob = await fileResponse.blob();
        const type = meta.type || blob.type || 'image/jpeg';
        file = new File([blob], meta.name || 'compartida.jpg', { type });
      }
    }

    await Promise.all([cache.delete(SHARE_META_URL), cache.delete(SHARE_FILE_URL)]);

    const link = firstUrlIn(meta.url, meta.text);
    const title = meta.title?.trim() || null;
    if (!file && !link) return null;
    return { file, link, title };
  } catch {
    // A share we cannot read is not worth an error message: the user can
    // always add the garment the usual way.
    return null;
  }
}
