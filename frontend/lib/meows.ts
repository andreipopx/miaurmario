/**
 * «Solo miau»: Stinky's words become meows, put together here and never by the
 * model. Seeded, so the same look meows the same way every time it is shown.
 * (The server has its own twin in backend/app/utils/meows.py for push and chat.)
 */

const SOUNDS = [
  'Miau',
  'Miau miau',
  'Miaaau',
  'Mrrp',
  'Mrrrau',
  'Prrr',
  'Prrrrr',
  'Mew',
  'Miu',
  'Ñam',
  'Mrau',
  'Miaaaaau',
];
const ENDINGS = ['.', '.', '.', '!', '?', '…', '~'];
const ASIDES = ['*ronronea*', '*se estira*', '*mueve la cola*', '*parpadea despacio*', '🐾'];

/** A small deterministic PRNG (mulberry32) seeded from a string hash. */
function rngFor(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function meows(seed: string, maxPhrases = 4): string {
  const rand = rngFor(seed);
  const pick = <T,>(list: readonly T[]) => list[Math.floor(rand() * list.length)];
  const phrases: string[] = [];
  const count = 1 + Math.floor(rand() * maxPhrases);
  for (let i = 0; i < count; i += 1) {
    let sound = pick(SOUNDS);
    if (rand() < 0.15) sound = `${sound}, ${pick(SOUNDS).toLowerCase()}`;
    phrases.push(sound + pick(ENDINGS));
  }
  if (rand() < 0.3) phrases.splice(Math.floor(rand() * (phrases.length + 1)), 0, pick(ASIDES));
  return phrases.join(' ');
}

/** Plain text out of whatever a tip was given, to seed its meows. */
export function seedOf(node: unknown): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(seedOf).join('');
  if (typeof node === 'object' && 'props' in (node as object)) {
    return seedOf((node as { props?: { children?: unknown } }).props?.children);
  }
  return '';
}
