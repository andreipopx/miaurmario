import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { NextResponse } from 'next/server';

// Every script and stylesheet of this build, for the service worker to keep
// when the app is installed, so any screen opens offline, including the bits a
// page only loads once it's on screen (dialogs, the photo viewer…). See
// WARM_OFFLINE in public/sw.js.
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

let files: string[] | null = null;
let posters: string[] | null = null;

async function walk(dir: string, prefix = ''): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((e) =>
      e.isDirectory() ? walk(path.join(dir, e.name), `${prefix}${e.name}/`) : [`${prefix}${e.name}`]
    )
  );
  return nested.flat();
}

// Stinky's still frames: the empty states show them, and they're the fallback
// when an animation isn't on the phone (the animations themselves are 5 MB).
// Plus the neutral still every Stinky starts from (still/), so he's never an empty circle.
const POSTER_DIRS = ['brand/stinky/head/poster', 'brand/stinky/head/still'];

export async function GET() {
  if (!files) {
    try {
      const all = await walk(path.join(process.cwd(), '.next', 'static'));
      files = all.filter((f) => /\.(js|css)$/.test(f)).map((f) => `/_next/static/${f}`).sort();
    } catch {
      files = [];
    }
  }
  if (!posters) {
    posters = [];
    for (const dir of POSTER_DIRS) {
      try {
        const all = await walk(path.join(process.cwd(), 'public', dir));
        posters.push(...all.filter((f) => /\.(svg|png)$/.test(f)).map((f) => `/${dir}/${f}`));
      } catch {
        /* missing directory: nothing to keep from it */
      }
    }
    posters.sort();
  }
  return NextResponse.json({ files, posters }, { headers: { 'Cache-Control': 'no-store' } });
}
