// Coat presets for the Stinky character family.
// A preset only recolours / adds surface decals on top of the shipped Stinky definitions
// (any mouth variant, light or dark), so face geometry, slit pupils, ":3" mouth, open/bite
// mouths and every animation clip keep working unchanged.
import fs from 'node:fs'
import { H } from './render.mjs'
const SDK = await import(process.env.ONEWORKS_AVATAR_DIST ?? '@oneworks/avatar')

export const VARIANTS = ['', '-open', '-bite', '-bite-half']
export const baseDef = (mouth = '', dark = false) =>
  JSON.parse(fs.readFileSync(`${H}stinky-head${mouth}${dark ? '-dark' : ''}.avatar.json`, 'utf8'))

const dec = (id, target, shape, x, y, width, height, rotation, color, opacity = 100, extra = {}) =>
  ({ id, label: id, targetPartId: target, shape, side: 'front', x, y, width, height, rotation, color, opacity, bend: 0, ...extra })

/** Tabby stripes from the SDK's own coat generator, with arbitrary colours (palette override),
 *  baked into explicit decals. Drops the SDK's light face patch and inner-ear marks (Stinky has its own). */
export function tabbyStripes({ mark, opacity = 90, algorithm = 'mackerel', density = 100, thickness = 100, seed = 'stinky', drop = [], scale = {} }) {
  const parts = baseDef().scene.entity.parts
  const palette = { ...SDK.getAvatarPalette('orange-tabby'), coat: { patch: '#ffffff', mark } }
  const out = SDK.resolveAvatarCoatPatternDecals({
    entityParts: parts, entityPreset: 'cat', palette, paletteId: 'orange-tabby',
    pattern: { ...SDK.DEFAULT_AVATAR_COAT_PATTERN, enabled: true, algorithm, density, thickness, jitter: 30, symmetry: 85, seed, algorithmSeed: seed },
  })
  return out
    .filter(d => !/tone-|ear-inner/.test(d.id) && !drop.some(k => d.id.includes(k)))
    .map(d => {
      const k = Object.keys(scale).find(k => d.id.includes(k))
      const s = k ? scale[k] : null
      return { ...d, id: d.id.replace('coat-', 'preset-'), opacity, ...(s ? { width: Math.round(d.width * (s.w ?? 1)), height: Math.round(d.height * (s.h ?? 1)), x: d.x + (s.dx ?? 0), y: d.y + (s.dy ?? 0) } : {}) }
    })
}

export const STINKY = {
  black: '#151515', blackHi: '#2a2826', blackSh: '#080808', white: '#f7f5f0', eye: '#cdb44e', nose: '#e6a1a6',
}

/** Apply a preset to one shipped definition (any mouth variant / theme). */
export function applyPreset(def, p) {
  const d = structuredClone(def)
  const s = d.scene
  if (!p.fur) return d // reference
  const fur = id => (p.ears?.[id]) ?? p.fur
  s.entity.parts = s.entity.parts.map(part => {
    const f = part.id.startsWith('cat-ear') ? fur(part.id) : p.fur
    const q = { ...part, baseColor: f.base, highlightColor: f.hi ?? f.base, shadowColor: f.sh ?? f.base }
    if (part.face) q.foregroundColor = p.eye
    return q
  })
  if (p.pupil) s.face.eyeHighlight = { ...s.face.eyeHighlight, color: p.pupil }
  if (p.outline && !d.metadata?.id?.endsWith('-dark')) s.effects.outline = { ...s.effects.outline, ...p.outline }
  const muzzleColor = p.muzzle?.color ?? p.fur.base
  const decals = []
  for (const x of s.decals) {
    if (x.id === 'stinky-muzzle') {
      if (p.under) decals.push(...p.under)
      if (p.muzzle) decals.push({ ...x, color: p.muzzle.color, ...(p.muzzle.geo ?? {}) })
      continue
    }
    if (x.id === 'stinky-blaze') {
      if (p.blaze) decals.push({ ...x, color: p.blaze.color, ...(p.blaze.geo ?? {}) })
      if (p.over) decals.push(...p.over)
      continue
    }
    if (x.id.startsWith('stinky-ear-inner')) { decals.push({ ...x, color: p.earInner ?? x.color, opacity: p.earInnerOpacity ?? x.opacity }); continue }
    if (x.id.startsWith('stinky-ear-fur')) { if (p.earFur !== null) decals.push({ ...x, color: p.earFur ?? x.color, opacity: p.earFurOpacity ?? x.opacity }); continue }
    if (x.id.startsWith('stinky-whisker')) { decals.push({ ...x, color: p.whisker ?? x.color, opacity: p.whiskerOpacity ?? x.opacity }); continue }
    if (x.id.endsWith('-carve')) { decals.push({ ...x, color: muzzleColor }); continue }
    if (x.id === 'stinky-nose') { decals.push({ ...x, color: p.nose ?? x.color }); continue }
    decals.push(x)
  }
  s.decals = decals
  d.metadata = { ...d.metadata, name: d.metadata.name.replace('Stinky', p.name), id: d.metadata.id.replace('stinky', `preset-${p.id}`) }
  return d
}

/** Post-process the captured SVG (same place the slit pupils are applied, works on the live DOM too):
 *  odd eyes (recolour eye-1) and soft-edged decals (Gaussian blur on chosen decal ids). */
export function svgHookFor(p) {
  if (!p.eyeRight && !p.blur) return undefined
  return svg => {
    if (p.eyeRight) svg = svg.replace(/(<path data-avatar-face-feature="eye-1"[^>]*?fill=")([^"]+)(")/, `$1${p.eyeRight}$3`)
    if (p.blur) {
      let defs = ''
      for (const [id, sd] of Object.entries(p.blur)) {
        const fid = `soft-${id}`
        defs += `<filter id="${fid}" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${sd}"/></filter>`
        svg = svg.replace(new RegExp(`(<path [^>]*data-avatar-surface-decal="${id}")`, 'g'), `$1 filter="url(#${fid})"`)
      }
      svg = svg.replace(/(<svg[^>]*>)/, `$1<defs>${defs}</defs>`)
    }
    return svg
  }
}

// ---------------------------------------------------------------- presets
const CREAM = '#fbecd6'
const ORANGE = { base: '#e8913f', hi: '#f3ad66', sh: '#c06e2b' }
const band = (id, x, y, w, h, rot, bend, color, opacity) =>
  dec(id, 'cat-head', 'tapered-band', x, y, w, h, rot, color, opacity, { bend })
/** Hand-placed forehead "M" (5 thin bands) + SDK-generated cheek/side stripes, thinned. */
const tabby = (c, o = 90, { forehead = true, drop = [] } = {}) => [
  ...(forehead ? [
    band('preset-f-c', 0, -70, 7, 40, 180, 0, c, o),
    band('preset-f-l1', -15, -66, 6, 34, 192, 0, c, o), band('preset-f-r1', 15, -66, 6, 34, 168, 0, c, o),
    band('preset-f-l2', -31, -60, 6, 28, 205, 4, c, o), band('preset-f-r2', 31, -60, 6, 28, 155, -4, c, o),
  ] : []),
  ...tabbyStripes({ mark: c, opacity: o, thickness: 85, drop: ['back-', 'side-lower', 'forehead', 'eye-line', 'temple', 'ear-root', ...drop] }),
]
let n = 0
const cluster = (cx, cy, color, blobs) => blobs.map(([dx, dy, w, h, r]) => dec(`preset-tortie-${n++}`, 'cat-head', 'ellipse', cx + dx, cy + dy, w, h, r, color))
const TO = '#d27530', TO2 = '#a9572a', TC = '#e6a05a'
const TORTIE = [
  ...cluster(-66, -46, TO, [[0, 0, 64, 40, -25], [-18, 18, 40, 36, 10], [16, -14, 34, 24, -40], [-30, -8, 26, 30, 0]]),
  ...cluster(-96, 22, TO2, [[0, 0, 30, 54, 8], [8, 24, 24, 26, 0]]),
  ...cluster(-62, 8, TC, [[0, 0, 16, 12, 20]]),
  ...cluster(0, -78, TO, [[0, 0, 18, 30, 0], [6, 16, 12, 18, 15]]),
  ...cluster(70, -62, TO2, [[0, 0, 46, 28, 28], [16, 12, 24, 22, 0]]),
  ...cluster(98, 14, TO, [[0, 0, 28, 46, -12], [-8, 22, 20, 18, 0]]),
  ...cluster(60, 50, TO2, [[0, 0, 30, 18, 30]]),
  ...cluster(-70, 52, TO, [[0, 0, 30, 20, -25]]),
]
const SEAL = '#4a2c20'

export const PRESETS = [
  { id: 'esmoquin', name: 'Esmoquin', note: 'current Stinky (reference)' },
  {
    id: 'naranja-atigrado', name: 'Naranja atigrado', note: 'orange tabby, like Chan',
    fur: ORANGE, eye: '#e9c64a', nose: '#e39486', earInner: '#eda39b', earFur: CREAM, earFurOpacity: 85,
    muzzle: { color: CREAM, geo: { width: 118, height: 90, y: 54 } },
    under: tabby('#b8561a', 92), outline: { color: '#2a1608' }, sadSaturation: .8,
  },
  {
    id: 'naranja-blanco', name: 'Naranja y blanco', note: 'orange & white bicolour',
    fur: ORANGE, eye: '#c9b34a', nose: '#f0a3a8', earInner: '#eda39b', earFur: CREAM, earFurOpacity: 80,
    under: tabby('#c4621f', 75, { forehead: false }),
    muzzle: { color: '#fbf7f0' }, blaze: { color: '#fbf7f0' }, outline: { color: '#2a1608' },
  },
  {
    id: 'negro', name: 'Negro', note: 'solid black',
    fur: { base: '#161616', hi: '#2a2826', sh: '#080808' }, eye: '#e9b92c', nose: '#5a4448', earInner: '#c98f94', earInnerOpacity: 60, earFur: null,
  },
  {
    id: 'blanco', name: 'Blanco', note: 'white, odd eyes (SVG post-process)',
    fur: { base: '#f6f3ec', hi: '#ffffff', sh: '#dcd6cb' }, eye: '#6fb4e3', eyeRight: '#e7b53a', nose: '#f0a0a8',
    earInner: '#f0a8ae', earInnerOpacity: 90, earFur: '#ffffff', whisker: '#b9b2a6', whiskerOpacity: 90,
  },
  {
    id: 'gris', name: 'Gris', note: 'British blue-grey, copper eyes',
    fur: { base: '#8995a3', hi: '#a5b0bc', sh: '#6a7583' }, eye: '#e59a33', nose: '#6b7380', earInner: '#c49aa3', earInnerOpacity: 65, earFur: '#b8c1cb', earFurOpacity: 60,
    muzzle: { color: '#9aa5b2', geo: { width: 112, height: 86, y: 55 } }, outline: { color: '#1d232b' },
  },
  {
    id: 'atigrado', name: 'Atigrado', note: 'brown tabby',
    fur: { base: '#8f7255', hi: '#ab8d6d', sh: '#6a533c' }, eye: '#9fb446', nose: '#c27466', earInner: '#d79a92', earFur: '#e6d6bf', earFurOpacity: 70,
    muzzle: { color: '#eadcc4', geo: { width: 112, height: 86, y: 55 } },
    under: tabby('#2c2017', 90), outline: { color: '#1b130c' },
  },
  {
    id: 'atigrado-gris', name: 'Atigrado gris', note: 'silver/grey tabby',
    fur: { base: '#9a9a96', hi: '#b5b5b0', sh: '#77776f' }, eye: '#a9c255', nose: '#c98a8e', earInner: '#d79a92', earFur: '#eeeeea', earFurOpacity: 70,
    muzzle: { color: '#eeeeea', geo: { width: 112, height: 86, y: 55 } },
    under: tabby('#262626', 90), outline: { color: '#141414' },
  },
  {
    id: 'siames', name: 'Siamés', note: 'seal colour-point (soft mask = SVG blur)',
    fur: { base: '#efe2cc', hi: '#fbf3e4', sh: '#d6c4a6' }, ears: { 'cat-ear-left': { base: SEAL }, 'cat-ear-right': { base: SEAL } },
    eye: '#5fa9e6', nose: '#2e1a14', earInner: '#7a4a3c', earInnerOpacity: 55, earFur: null,
    under: [dec('preset-point-soft', 'cat-head', 'ellipse', 0, 20, 160, 150, 0, SEAL), dec('preset-point-brow', 'cat-head', 'rounded-triangle', 0, -10, 60, 80, 180, SEAL)],
    blur: { 'preset-point-soft': 16, 'preset-point-brow': 8 },
    muzzle: { color: SEAL, geo: { opacity: 0 } }, whisker: '#f7f5f0', outline: { color: '#2a1a12' },
  },
  {
    id: 'calico', name: 'Calicó', note: 'white + orange/black patches',
    fur: { base: '#f7f3ea', hi: '#ffffff', sh: '#ddd6c8' }, ears: { 'cat-ear-left': { base: '#e8913f', hi: '#f3ad66', sh: '#c06e2b' }, 'cat-ear-right': { base: '#1c1a19', hi: '#2f2c2a', sh: '#0b0a0a' } },
    eye: '#c9b347', nose: '#f0a0a8', earInner: '#eda39b', earFur: CREAM, whisker: '#b9b2a6',
    under: [
      dec('preset-patch-orange', 'cat-head', 'rounded', -62, -46, 118, 92, -18, '#e8913f', 100),
      dec('preset-patch-orange-2', 'cat-head', 'ellipse', -88, 20, 60, 70, 10, '#e8913f', 100),
      dec('preset-patch-black', 'cat-head', 'rounded', 70, -52, 104, 84, 22, '#1c1a19', 100),
      dec('preset-patch-black-2', 'cat-head', 'ellipse', 98, 22, 44, 56, -12, '#1c1a19', 100),
      dec('preset-patch-orange-3', 'cat-head', 'ellipse', 74, -10, 40, 30, 15, '#e8913f', 100),
    ],
    muzzle: { color: '#f7f3ea' }, blaze: { color: '#f7f3ea', geo: { width: 40, height: 104 } },
  },
  {
    id: 'carey', name: 'Carey', note: 'tortoiseshell (mottle = blurred clusters)',
    fur: { base: '#1a1717', hi: '#2c2726', sh: '#080707' }, ears: { 'cat-ear-left': { base: TO2 } },
    eye: '#e2b13a', nose: '#6a4a46', earInner: '#c98f94', earInnerOpacity: 60, earFur: null,
    under: TORTIE, blur: Object.fromEntries(TORTIE.map(x => [x.id, 1.5])),
  },
]

/** Clips carry two coat-specific bits: the wave paw colour (auxiliary part) and the sad colour grade
 *  (saturation .56 turns orange coats brown). Presets patch both. */
export function clipsFor(p, LIB) {
  const lib = structuredClone(LIB)
  if (!p.fur) return lib
  const paw = p.paw ?? p.fur
  for (const kf of lib.wave.keyframes) for (const a of kf.patch.auxiliaryParts ?? []) {
    if (a.part?.id === 'stinky-wave-paw') Object.assign(a.part, { baseColor: paw.base, highlightColor: paw.hi ?? paw.base, shadowColor: paw.sh ?? paw.base })
  }
  if (p.sadSaturation) for (const kf of lib.sad.keyframes) {
    const g = kf.patch.colorGrade
    if (g && g.saturation < 1) g.saturation = p.sadSaturation
  }
  return lib
}
