/**
 * Each person's own Stinky: the name, coat and eyes they gave the stylist cat
 * (Ajustes → Tu Stinky). Stored on the account (users.stinky_name / stinky_coat)
 * and mirrored in a cookie, so the server renders their cat and their cat's
 * name in every text from the first byte, with no flash of the tuxedo.
 *
 * Coat ids must match backend/app/utils/stinky_persona.py.
 */

export const STINKY_PERSONA_COOKIE = 'mm_cat';
export const DEFAULT_STINKY_NAME = 'Stinky';
export const STINKY_NAME_MAX_LENGTH = 20;

export const STINKY_COATS = [
  'esmoquin',
  'naranja-atigrado',
  'naranja-blanco',
  'negro',
  'blanco',
  'gris',
  'atigrado',
  'atigrado-gris',
  'siames',
  'calico',
] as const;
export type StinkyCoat = (typeof STINKY_COATS)[number];
export const DEFAULT_STINKY_COAT: StinkyCoat = 'esmoquin';

/** "natural" = the coat's own eyes; the others recolour them. */
export const STINKY_EYES = ['natural', 'ambar', 'verde', 'azul', 'cobre'] as const;
export type StinkyEyes = (typeof STINKY_EYES)[number];
export const DEFAULT_STINKY_EYES: StinkyEyes = 'natural';

/** Swatch colours, the same ones the eye renders use. */
export const STINKY_EYE_COLORS: Record<Exclude<StinkyEyes, 'natural'>, string> = {
  ambar: '#e2b13a',
  verde: '#9fb446',
  azul: '#5fa9e6',
  cobre: '#e08a2e',
};

/** Copper barely shows on orange fur, so those coats get a redder, deeper copper. */
const EYE_COLOR_OVERRIDES: Partial<Record<StinkyCoat, Partial<typeof STINKY_EYE_COLORS>>> = {
  'naranja-atigrado': { cobre: '#b5441c' },
  'naranja-blanco': { cobre: '#b5441c' },
};

/** The colour the eyes are drawn in on this coat (matches the renders). */
export const stinkyEyeColor = (coat: StinkyCoat, eyes: Exclude<StinkyEyes, 'natural'>) =>
  EYE_COLOR_OVERRIDES[coat]?.[eyes] ?? STINKY_EYE_COLORS[eyes];

/** Each coat's own eyes, when they match one of the choices (white has one blue, one gold). */
export const STINKY_NATURAL_EYES: Record<StinkyCoat, Exclude<StinkyEyes, 'natural'> | null> = {
  esmoquin: 'ambar',
  'naranja-atigrado': 'ambar',
  'naranja-blanco': 'ambar',
  negro: 'ambar',
  blanco: null,
  gris: 'cobre',
  atigrado: 'verde',
  'atigrado-gris': 'verde',
  siames: 'azul',
  calico: 'ambar',
};

export interface StinkyPersona {
  name: string;
  coat: StinkyCoat;
  eyes: StinkyEyes;
}

export const DEFAULT_STINKY_PERSONA: StinkyPersona = {
  name: DEFAULT_STINKY_NAME,
  coat: DEFAULT_STINKY_COAT,
  eyes: DEFAULT_STINKY_EYES,
};

export const isStinkyCoat = (value: unknown): value is StinkyCoat =>
  typeof value === 'string' && (STINKY_COATS as readonly string[]).includes(value);
export const isStinkyEyes = (value: unknown): value is StinkyEyes =>
  typeof value === 'string' && (STINKY_EYES as readonly string[]).includes(value);

/**
 * Which pre-rendered set draws this coat with these eyes: the coat's own set when the
 * eyes are its own, "<coat>--<eyes>" otherwise.
 */
export function stinkyAssetSet(coat: StinkyCoat, eyes: StinkyEyes = DEFAULT_STINKY_EYES): string {
  if (eyes === 'natural' || STINKY_NATURAL_EYES[coat] === eyes) return coat;
  return `${coat}--${eyes}`;
}

/** Same rule as the backend: letters, digits, spaces and ' ’ . · - inside. */
// (Built from a string: the `u` flag isn't available to the compile target, browsers have it.)
const NAME_RE = new RegExp("^[\\p{L}\\p{N}](?:[\\p{L}\\p{N}\\p{M} '’.·-]*[\\p{L}\\p{N}\\p{M}])?$", 'u');

/** Normalised name, or null when it isn't one the backend would accept. */
export function cleanStinkyName(raw: string): string | null {
  const name = raw.split(/\s+/).filter(Boolean).join(' ');
  if (!name || name.length > STINKY_NAME_MAX_LENGTH || !NAME_RE.test(name)) return null;
  return name;
}

export function personaFromProfile(profile: {
  stinky_name?: string | null;
  stinky_coat?: string | null;
  stinky_eyes?: string | null;
}): StinkyPersona {
  return {
    name: profile.stinky_name || DEFAULT_STINKY_NAME,
    coat: isStinkyCoat(profile.stinky_coat) ? profile.stinky_coat : DEFAULT_STINKY_COAT,
    eyes: isStinkyEyes(profile.stinky_eyes) ? profile.stinky_eyes : DEFAULT_STINKY_EYES,
  };
}

export const samePersona = (a: StinkyPersona, b: StinkyPersona) =>
  a.name === b.name && a.coat === b.coat && a.eyes === b.eyes;
export const isDefaultPersona = (p: StinkyPersona) => samePersona(p, DEFAULT_STINKY_PERSONA);

/** "coat|eyes|name" (the name URI-encoded); a missing or broken cookie is the default cat. */
export function parsePersonaCookie(value: string | undefined | null): StinkyPersona {
  if (!value) return DEFAULT_STINKY_PERSONA;
  const [coat, eyes, ...rest] = value.split('|');
  let name = DEFAULT_STINKY_NAME;
  if (rest.length) {
    try {
      name = cleanStinkyName(decodeURIComponent(rest.join('|'))) ?? DEFAULT_STINKY_NAME;
    } catch {
      /* malformed: keep the default name */
    }
  }
  return {
    name,
    coat: isStinkyCoat(coat) ? coat : DEFAULT_STINKY_COAT,
    eyes: isStinkyEyes(eyes) ? eyes : DEFAULT_STINKY_EYES,
  };
}

export const serializePersona = (p: StinkyPersona) =>
  `${p.coat}|${p.eyes}|${encodeURIComponent(p.name)}`;

const STINKY_WORD = /\bStinky\b/g;

/** Replace the cat's name in a text written for the default Stinky. */
export const personalizeText = (text: string, name: string) =>
  name === DEFAULT_STINKY_NAME ? text : text.replace(STINKY_WORD, name);

type Messages = { [key: string]: string | Messages };

/** Every message, renamed (next-intl placeholders and ICU syntax are untouched). */
export function personalizeMessages<T extends Messages>(messages: T, name: string): T {
  if (name === DEFAULT_STINKY_NAME) return messages;
  const walk = (node: Messages): Messages => {
    const out: Messages = {};
    for (const [key, value] of Object.entries(node)) {
      out[key] = typeof value === 'string' ? personalizeText(value, name) : walk(value);
    }
    return out;
  };
  return walk(messages) as T;
}
