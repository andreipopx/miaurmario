// Turns the mascot's animated WebPs (frontend/public/brand/stinky/head/anim) into PNG
// sequences so Remotion can pick the exact frame for each video frame.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const root = path.resolve(import.meta.dirname, '..');
const head = path.join(root, '../frontend/public/brand/stinky/head');
const clips = JSON.parse(fs.readFileSync(path.join(head, 'stinky.animations.json'), 'utf8')).groups.states.clips;
const STATES = ['idle', 'happy', 'wave', 'thinking', 'sleepy', 'purr'];

const meta = {};
for (const state of STATES) {
  const src = path.join(head, 'anim', `stinky-${state}.webp`);
  const { pages } = await sharp(src).metadata();
  const dir = path.join(root, 'public/stinky', state);
  fs.mkdirSync(dir, { recursive: true });
  for (let i = 0; i < pages; i++) {
    await sharp(src, { page: i }).png().toFile(path.join(dir, `${String(i).padStart(3, '0')}.png`));
  }
  meta[state] = { frames: pages, durationMs: clips[state].durationMs, loop: clips[state].playback === 'loop' };
}
fs.writeFileSync(path.join(root, 'src/stinky-meta.json'), JSON.stringify(meta, null, 1) + '\n');
fs.copyFileSync(path.join(head, 'stinky-head.svg'), path.join(root, 'public/stinky-head.svg'));
console.log(meta);
