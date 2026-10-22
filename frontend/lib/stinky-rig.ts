/**
 * Stinky as a parametric vector rig: pure data for `components/stinky/stinky-svg.tsx`.
 *
 * - Shapes: the exact paths of `public/brand/stinky/head/stinky-head.svg` (the OneWorks export the
 *   WebP clips were rendered from), in its 420-unit path space (head centre ≈ (210, 214)), rounded.
 * - Coats: the looks of `scripts/stinky-coats/presets.mjs` as colours and clipped pattern shapes.
 * - Clips: the keyframes of `stinky.animations.json`, verbatim (times, easings, face and view
 *   values), plus what the 3D scene could not animate: ears and pupils.
 * - `poseAt` evaluates a clip at any time; `rigTracks` turns a clip into per-part keyframes for
 *   the Web Animations API, and `poseTransforms` gives the static (neutral) pose.
 */

import { STINKY_MOUTH_TIMELINE, STINKY_STATE_META, type StinkyMouth, type StinkyState } from '@/components/stinky/stinky-states'
import { stinkyEyeColor, type StinkyCoat, type StinkyEyes } from './stinky-persona'

// ---------------------------------------------------------------------------------------------- shapes

/** Path data in the export's path space (viewBox 0 0 420 420 before the 1.34 view scale). */
export const STINKY_SHAPES = {
  head: 'M236 136Q236 136 237 136Q238 136 238 136Q238 136 238 137Q239 137 240 137Q240 137 241 137Q241 137 241 138Q242 138 242 138Q242 138 243 138Q243 138 244 138Q244 139 244 139Q244 139 245 139Q246 139 246 140Q248 140 250 141Q252 142 253 142Q255 143 258 144Q261 145 263 146Q264 146 265 147Q267 147 269 148Q273 150 278 152Q279 152 280 153Q281 153 282 153Q282 154 282 154Q283 154 283 155Q284 155 284 155Q285 155 285 155Q285 155 285 156Q286 156 286 156Q286 156 287 156Q287 156 287 157Q288 157 288 158Q289 158 289 158Q290 158 290 158Q291 159 291 160Q292 160 292 160Q293 160 293 160Q293 160 293 161Q294 160 294 161Q294 161 294 162Q295 162 295 162C295 162 295 162 295 163C303 171 302 168 309 178C313 182 316 189 318 194C319 197 319 199 320 201C320 201 320 202 320 202C320 204 321 207 321 209C321 209 321 210 321 210C321 215 321 221 320 226C319 231 317 237 314 242C313 244 312 246 310 249C310 249 310 249 310 250C308 252 306 255 304 258C298 264 292 269 285 273C280 276 275 279 270 281C265 284 259 285 254 287C253 287 252 287 252 288C250 288 249 289 248 289C247 290 247 290 246 290C244 290 242 290 240 291C239 291 239 291 238 291C236 291 235 291 233 291C232 291 231 291 230 291C228 291 227 291 225 291C224 291 223 292 222 292C220 292 219 292 218 292C217 292 217 292 217 293C216 293 216 293 215 294C215 294 214 294 214 294C210 294 207 295 203 294C201 294 200 293 198 292C196 292 195 292 193 292C192 292 191 291 190 291C188 291 186 291 184 291C183 291 182 291 181 291C175 290 176 290 172 289C172 289 171 289 171 289C164 287 157 284 150 281C145 279 140 276 135 273C121 264 108 250 102 234C100 228 100 224 99 218C99 218 99 217 99 217C99 212 99 206 100 201C101 199 101 197 102 194C102 194 102 194 103 193C104 191 105 188 106 186C108 180 113 174 117 169C120 167 123 164 126 162C127 161 128 160 129 160C129 159 129 159 129 159Q129 159 130 159Q130 158 131 157Q131 157 132 157Q132 157 133 157Q133 156 134 155Q134 155 135 155Q135 155 136 155Q136 154 137 153Q138 153 138 153Q138 153 139 153Q139 152 140 152Q141 152 141 151Q142 151 142 151Q142 151 143 151Q143 151 144 151Q144 150 144 150Q144 150 145 150Q145 150 146 150Q146 149 147 149Q149 148 150 147Q151 147 151 147Q152 147 152 146Q153 146 154 146Q154 146 155 146Q155 145 156 145Q157 145 158 145Q159 144 160 144Q161 144 161 143Q162 143 163 143Q164 143 164 142Q165 142 166 142Q166 142 167 142Q167 142 167 141Q168 141 168 141Q169 141 170 141Q170 140 170 140Q171 140 172 140Q172 140 172 139Q173 139 173 139Q174 139 174 139Q175 139 175 139Q175 139 175 138Q176 138 176 138Q177 138 178 138Q178 137 178 137Q178 137 179 137Q180 137 182 137Q182 136 183 136Q183 136 184 136Q186 136 188 136C190 136 189 136 190 136C192 136 194 136 196 136C196 136 197 135 197 135C197 135 198 135 198 135C199 135 201 135 202 135C204 135 204 135 205 134C205 134 206 134 206 134C210 134 213 134 217 134C217 134 218 134 218 134C219 134 220 135 221 135C221 135 222 135 222 135C224 135 225 135 227 135C228 135 229 136 230 136C230 136 231 136 231 136C235 136 234 137 236 136Z',
  earL: 'M188 136Q186 136 184 136Q183 136 183 136Q182 136 182 137Q180 137 179 137Q178 137 178 137Q178 137 178 138Q177 138 176 138Q176 138 175 138Q175 139 175 139Q175 139 174 139Q174 139 173 139Q173 139 172 139Q172 140 172 140Q171 140 170 140Q170 140 170 141Q169 141 168 141Q168 141 167 141Q167 142 167 142Q166 142 166 142Q165 142 164 142Q164 143 163 143Q162 143 161 143Q161 144 160 144Q159 144 158 145Q157 145 156 145Q155 145 155 146Q154 146 154 146Q153 146 152 146Q152 147 151 147Q151 147 150 147Q149 148 147 149Q146 149 146 150Q145 150 145 150Q144 150 144 150Q144 150 144 151Q143 151 143 151Q142 151 142 151Q142 151 141 151Q141 152 140 152Q139 152 139 153Q138 153 138 153Q138 153 137 153Q136 154 136 155Q135 155 135 155Q134 155 134 155Q133 156 133 157Q132 157 132 157Q131 157 131 157Q130 158 130 159Q129 159 129 159C129 156 129 158 130 151C130 145 131 139 132 133C133 120 135 107 137 94C138 88 140 83 141 77C142 76 142 74 143 73C143 73 143 73 143 73C144 72 144 72 144 72C144 72 144 71 145 71C146 70 147 72 148 73C153 79 155 80 158 86C162 91 165 97 169 102C172 108 176 114 179 120C188 135 182 133 188 136Z',
  earR: 'M294 161Q294 160 293 161Q293 160 293 160Q293 160 292 160Q292 160 291 160Q291 159 290 158Q290 158 289 158Q289 158 288 158Q288 157 287 157Q287 156 287 156Q286 156 286 156Q286 156 285 156Q285 155 285 155Q285 155 284 155Q284 155 283 155Q283 154 282 154Q282 154 282 153Q281 153 280 153Q279 152 278 152Q273 150 269 148Q267 147 265 147Q264 146 263 146Q261 145 258 144Q255 143 253 142Q252 142 250 141Q248 140 246 140Q246 139 245 139Q244 139 244 139Q244 139 244 138Q243 138 243 138Q242 138 242 138Q242 138 241 138Q241 137 241 137Q240 137 240 137Q239 137 238 137Q238 136 238 136Q238 136 237 136Q236 136 236 136C240 131 241 125 244 120C248 113 251 107 255 100C258 94 262 88 266 83C268 80 268 79 270 76C271 76 272 75 272 74C273 74 273 74 273 74C274 74 275 74 276 74C276 74 276 74 276 73C276 73 277 73 277 73C277 73 278 75 278 75C280 78 280 80 281 83C282 87 282 89 283 94C284 95 284 97 285 99C286 103 287 108 287 112C288 119 290 125 291 132C292 140 293 149 294 157C294 160 294 159 294 161ZM294 161C295 161 294 161 295 162Q295 162 294 162Q294 161 294 161Z',
  earInL: 'M139 130.3C139.1 129 139.1 127.7 139.3 126.4C139.8 124.3 140.8 122.5 142.5 121C147.1 116.8 155.8 117.6 159 123.2C160.9 126.5 160.5 130.4 160.1 134C159.7 137.7 158.9 141.4 157.8 145C157 147.8 156.1 150.6 154.8 153.3C154.5 153.8 154.2 154.4 153.9 154.9C153.7 155.3 153.3 155.5 153.1 155.8C153 156.1 153.1 156.4 153 156.7C152.9 157.3 152.6 157.8 152.2 158.2C151.3 158.6 150.8 157.8 150.5 157.1C150.3 156.8 150.3 156.5 150.2 156.3C149.9 156.1 149.5 155.9 149.3 155.7C148.3 154.8 147.4 153.5 146.8 152.5C143.8 147.8 141.6 142.6 140.2 137.2C139.4 134.1 139.4 133.5 139 130.3Z',
  earInR: 'M257.5 126.2C258.6 123.3 258.6 122.3 261 120.3C265.8 116.4 274.2 117.7 277.5 122.9C278.8 125 279.2 127.1 279.1 129.6C279.1 130.7 278.8 131.8 278.5 132.9C276.9 139.3 273.9 145.6 270 150.9C269.3 151.8 268.3 153.2 267.4 154C267.1 154.2 266.7 154.3 266.4 154.6C266.2 154.8 266.2 155.1 266.1 155.3C265.8 155.9 265.5 156.2 265 156.5C264 156.6 263.7 155.8 263.5 154.9C263.4 154.7 263.5 154.4 263.4 154.1C263.2 153.8 262.9 153.6 262.6 153.2C262 152.2 261.3 150.6 260.9 149.4C258.5 143.2 257.1 136.2 257.2 129.6C257.3 128.4 257.4 127.3 257.5 126.2Z',
  muzzle: 'M200.1 216C195.6 216.3 194.7 216.2 190.2 217.1C188.5 217.5 186.8 217.9 185.1 218.5C183.4 219 181.7 219.6 180 220.3C178.3 221 176.7 221.8 175.1 222.6C166.2 227.3 157.6 235.1 156.1 245.5C155.8 247.2 155.7 249 155.8 250.7C156 254 156.9 257.5 158.2 260.5C162.4 270 171.6 275.9 181.1 279.1C188.8 281.7 196.9 282.7 204.9 282.7C212.8 282.7 220.8 281.8 228.2 279.1C232.7 277.5 233.2 277 237.2 274.7C238.4 273.7 239.7 272.9 240.8 271.8C243.1 269.7 244.8 267.5 246.1 264.7C247.5 261.8 248.3 259 248.6 255.8C248.7 254.1 248.8 252.4 248.6 250.7C248.5 248.9 248.2 247.2 247.7 245.5C244.7 234.9 235.2 227.3 225.8 222.6C224.1 221.8 222.3 221 220.6 220.3C217.2 218.9 213.6 217.9 210 217.1C205.4 216.2 204.6 216.3 200.1 216Z',
  blaze: 'M216.9 207.1C215.8 212.3 216 214.3 212.9 218.6C207.9 225.3 198 227.1 191.1 222.1C186.2 218.6 184 212.9 183.6 207.1C183.4 205.1 183.7 203.1 183.9 201.1C185.1 191 188.3 181 192.6 171.9C194.4 168.3 196.3 164.4 198.9 161.3C199.3 160.8 200 160.5 200.4 159.9C200.7 159.5 200.7 159 200.9 158.5C201.4 157.4 201.9 156.3 203.2 156C204.3 156.3 204.7 157.4 204.8 158.5C204.9 159 204.8 159.5 205 159.9C205.3 160.5 205.8 160.8 206.2 161.3C207.3 163 208.3 165.6 209 167.4C210.9 172.4 212.4 177.6 213.6 182.7C215.1 188.8 216.2 194.9 216.7 201.1C216.8 203.1 216.8 205.1 216.9 207.1Z',
}

/** The export's view: `translate(0 18) translate(210 210) scale(1.34) translate(-210 -210)`. */
export const VIEW = { scale: 1.34, x: 210 - 210 * 1.34, y: 18 + 210 - 210 * 1.34, posY: 18 } as const
/** Head centre in path space (the face pivot). */
export const HEAD_CENTER = { x: 210, y: 214 } as const
/** Surface decals (muzzle, nose, patterns…) sit on the head at `200.6 + 0.73·x, 214 + 0.68·y` of their scene coords. */
export const decal = (x: number, y: number) => ({ x: 200.6 + 0.73 * x, y: 214 + 0.68 * y })
export const decalSize = (w: number, h: number) => ({ w: 0.73 * w, h: 0.68 * h })
/** How far the features travel per radian of yaw / pitch (measured on the rendered clips). */
export const FACE_SHIFT = 76
/**
 * Coupled motion. The 3D scene turned a sphere, so its outline never moved and the features slid
 * across it. Here the whole head turns: the skull (outline + ears) takes part of the travel and
 * part of the tilt about a point low on the head, the features take the rest (parallax), so the
 * features still land where the clips put them.
 */
export const SKULL = { shift: 30, rot: 0.7, pivot: { x: 210, y: 242 } } as const
/** The eye on the far side narrows a little as the head turns. */
export const EYE_SQUASH = 0.6
/** The clips' neutral yaw, already baked into the paths. */
export const NEUTRAL_YAW = -0.12

export const EYES = {
  /** Apparent ellipses at neutral, measured on the rendered clips (the exported SVG draws them 12 units higher than the WebPs; the right eye is a touch wider: it faces the camera more). */
  left: { cx: 167.9, cy: 214, rx: 14.8, ry: 12.25, rot: -12 },
  right: { cx: 233.2, cy: 214, rx: 15.5, ry: 12.25, rot: 8 },
  /** Eye height (SDK units) of the open eye; `height / 36` is the blink scale. */
  openHeight: 36,
  /** SDK eye rotations at neutral; the clips' values are deltas from these. */
  baseRot: 14,
  /** SDK gap at neutral; each eye moves `0.365 · Δgap` outward. */
  baseGap: 48,
  /** Vertical slit pupil (the live renderer's `slitPupilPath`, as two cubics). */
  pupil: 'M0-12C3-7 3 7 0 12C-3 7-3-7 0-12Z',
} as const

export const EARS = {
  left: { pivot: { x: 165, y: 152 }, inner: { cx: 150, cy: 137.7 } },
  right: { pivot: { x: 262, y: 154 }, inner: { cx: 268.1, cy: 136.5 } },
  /** The pale tuft is the inner-ear shape, scaled about its centre and moved down. */
  fur: { sx: 0.62, sy: 0.6, dy: 5.8 },
} as const

/** The ":3": two pink ellipses, each "carved" by a muzzle-coloured ellipse above it. */
export const MOUTH_NEUTRAL = {
  lip: { rx: 6.85, ry: 4.65, y: 239.15 },
  carve: { rx: 5.75, ry: 4.9, y: 236.3 },
  dx: 6.2,
  cx: 200.6,
} as const
export const MOUTH_OPEN = {
  open: { mouth: decalEllipse(0, 40, 18, 14), tongue: decalEllipse(0, 43.08, 11, 7) },
  bite: { mouth: decalEllipse(0, 42, 28, 21), tongue: decalEllipse(0, 47.25, 15.4, 8.4), fang: { y: 37.6, h: 11 } },
  'bite-half': { mouth: decalEllipse(0, 40.5, 26, 13), fang: { y: 39.1, h: 9 } },
  color: '#a8465a',
  tongue: '#ea8e9c',
  fang: '#fbf8f2',
  fangX: 7.5,
  fangW: 7,
} as const
function decalEllipse(x: number, y: number, w: number, h: number) {
  const c = decal(x, y)
  const s = decalSize(w, h)
  return { cx: c.x, cy: c.y, rx: s.w / 2, ry: s.h / 2 }
}
/** A rounded triangle pointing down (nose, fangs), centred on (cx, top..top+h). */
export const triangleDown = (cx: number, top: number, w: number, h: number) =>
  `M${r(cx - w / 2)} ${r(top)}Q${r(cx)} ${r(top - h * 0.12)} ${r(cx + w / 2)} ${r(top)}Q${r(cx + w * 0.42)} ${r(top + h * 0.55)} ${r(cx)} ${r(top + h)}Q${r(cx - w * 0.42)} ${r(top + h * 0.55)} ${r(cx - w / 2)} ${r(top)}Z`
export const NOSE = 'M191 233.2C191.4 229.6 195 227 198.5 225.6C199.5 225 201.7 225 202.7 225.6C206.2 227 209.5 229.6 209.8 233.2C207 235.8 203.8 236.3 200.4 236.3C197 236.3 193.8 235.8 191 233.2Z'
/** Whiskers as strokes (inner end first). */
export const WHISKERS: ReadonlyArray<readonly [number, number, number, number]> = [
  [172.5, 236, 140.4, 230], [172.8, 238.4, 140.6, 238.4], [172.8, 241.5, 141.2, 247.8],
  [229.1, 236, 263.1, 230], [229.2, 238.4, 263.8, 238.4], [229.4, 241.5, 264, 247.3],
]
/** The waving paw: an ellipse that pops in at the lower right and swings. Scene (x, y) → `1.17` path units. */
export const PAW = { cx: 312, cy: 213, rx: 31, ry: 42, k: 1.17, baseX: 116, baseY: 10 } as const

const r = (n: number) => Math.round(n * 10) / 10

/** A tapered stripe between two points: a lens `w` wide in the middle, bowed by `bend`. */
export function band(x1: number, y1: number, x2: number, y2: number, w: number, bend = 0): string {
  const mx = (x1 + x2) / 2
  const my = (y1 + y2) / 2
  const len = Math.hypot(x2 - x1, y2 - y1) || 1
  const nx = -(y2 - y1) / len
  const ny = (x2 - x1) / len
  const a = bend + w / 2
  const b = bend - w / 2
  // Quadratic control points sit at twice the bulge, so the lens is `w` wide at its middle.
  return `M${r(x1)} ${r(y1)}Q${r(mx + 2 * nx * a)} ${r(my + 2 * ny * a)} ${r(x2)} ${r(y2)}Q${r(mx + 2 * nx * b)} ${r(my + 2 * ny * b)} ${r(x1)} ${r(y1)}Z`
}

/**
 * Tabby stripes in scene units (eyes at y = 0, head edge at x ≈ ±140): [x1, y1, x2, y2, width, bend]
 * for the left side, mirrored for the right. Thin, long sweeps from the edge towards the eye,
 * matched by eye to the rendered sets (the SDK's mackerel generator).
 */
const CHEEK_STRIPES: ReadonlyArray<readonly [number, number, number, number, number, number]> = [
  [-104, -74, -82, -44, 3, -2],
  [-72, -68, -58, -40, 3, 0],
  [-134, -34, -76, -18, 3.6, -4],
  [-142, -8, -74, 4, 3.8, 2],
  [-136, 18, -82, 20, 3.6, 4],
  [-122, 44, -86, 36, 3.2, 3],
]
/** The forehead "M": five thin bands fanning out above the eyes, the middle one longest. */
const FOREHEAD_STRIPES: ReadonlyArray<readonly [number, number, number, number, number, number]> = [
  [0, -94, 0, -44, 4, 0],
  [-12, -88, -17, -48, 3.6, 1], [12, -88, 17, -48, 3.6, -1],
  [-25, -80, -35, -50, 3.4, 2], [25, -80, 35, -50, 3.4, -2],
]
/** Siamese point: soft dark ellipses (radial gradient, opaque to `fade`, clear at the rim). */
export const SIAMESE_MASK = {
  fade: 0.42,
  blobs: [
    { cx: 200.6, cy: 224, rx: 64, ry: 60, opacity: 1 },
    { cx: 200.6, cy: 240, rx: 44, ry: 48, opacity: 0.6 },
    { cx: 200.6, cy: 196, rx: 20, ry: 34, opacity: 0.55 },
  ],
} as const
export function stripePaths(forehead: boolean): string[] {
  const s = (p: readonly [number, number, number, number, number, number], m = 1) => {
    const a = decal(m * p[0], p[1])
    const b = decal(m * p[2], p[3])
    return band(a.x, a.y, b.x, b.y, p[4] * 0.7, m * p[5] * 0.7)
  }
  return [
    ...CHEEK_STRIPES.map(p => s(p)),
    ...CHEEK_STRIPES.map(p => s(p, -1)),
    ...(forehead ? FOREHEAD_STRIPES.map(p => s(p)) : []),
  ]
}

// ---------------------------------------------------------------------------------------------- coats

export interface Patch {
  shape: 'ellipse' | 'rounded'
  x: number
  y: number
  w: number
  h: number
  rot: number
  color: string
}
export interface CoatLook {
  fur: string
  /** Ears of another colour (siamese points, calico). */
  earL?: string
  earR?: string
  earInner: string
  earInnerOpacity: number
  /** The pale tuft inside the ear; null = none. */
  earFur: string | null
  earFurOpacity: number
  /** The muzzle shape scaled about its centre (the SDK presets resize it per coat); null = none. */
  muzzle: { color: string; sx: number; sy: number; dy: number } | null
  blaze: { color: string; sx: number; sy: number } | null
  nose: string
  whisker: string
  whiskerOpacity: number
  /** The coat's own iris colours, viewer's left and right (white: one blue, one gold). */
  eyes: readonly [string, string]
  /** The waving paw (the tuxedo waves a white glove; other coats their fur). */
  paw?: string
  /** Light-mode outline; dark mode always uses the cream one. */
  outline: string
  outlineOpacity: number
  stripes?: { color: string; opacity: number; forehead: boolean }
  patches?: readonly Patch[]
  /** Siamese: a soft dark mask over the face (a radial gradient). */
  mask?: string
}

const CREAM = '#fbecd6'
const ORANGE = '#e8913f'
const SEAL = '#4a2c20'
const muzzle = (color: string, w = 128, h = 98, y = 52) => ({ color, sx: w / 128, sy: h / 98, dy: (y - 52) * 0.68 })
const blaze = (color: string, w = 46, h = 110) => ({ color, sx: w / 46, sy: h / 110 })
const patch = (shape: Patch['shape'], x: number, y: number, w: number, h: number, rot: number, color: string): Patch =>
  ({ shape, x, y, w, h, rot, color })
const both = (c: string) => [c, c] as const

const BASE: Pick<CoatLook, 'earInnerOpacity' | 'earFurOpacity' | 'whisker' | 'whiskerOpacity' | 'outline' | 'outlineOpacity'> = {
  earInnerOpacity: 0.8, earFurOpacity: 0.7, whisker: '#f7f5f0', whiskerOpacity: 0.85, outline: '#0a0a0a', outlineOpacity: 0.9,
}

export const COAT_LOOKS: Readonly<Record<StinkyCoat, CoatLook>> = {
  esmoquin: {
    ...BASE, fur: '#151515', earInner: '#d9a3a6', earFur: '#e8e0da',
    muzzle: muzzle('#f7f5f0'), blaze: blaze('#f7f5f0'), nose: '#e6a1a6', eyes: both('#cdb44e'), paw: '#f7f5f0',
  },
  'naranja-atigrado': {
    ...BASE, fur: ORANGE, earInner: '#eda39b', earFur: CREAM, earFurOpacity: 0.85,
    muzzle: muzzle(CREAM, 118, 90, 54), blaze: null, nose: '#e39486', eyes: both('#e9c64a'),
    stripes: { color: '#b8561a', opacity: 0.92, forehead: true }, outline: '#2a1608', outlineOpacity: 0.9,
  },
  'naranja-blanco': {
    ...BASE, fur: ORANGE, earInner: '#eda39b', earFur: CREAM, earFurOpacity: 0.8,
    muzzle: muzzle('#fbf7f0'), blaze: blaze('#fbf7f0'), nose: '#f0a3a8', eyes: both('#c9b34a'),
    stripes: { color: '#c4621f', opacity: 0.75, forehead: false }, outline: '#2a1608', outlineOpacity: 0.9,
  },
  negro: {
    ...BASE, fur: '#161616', earInner: '#c98f94', earInnerOpacity: 0.6, earFur: null,
    muzzle: null, blaze: null, nose: '#5a4448', eyes: both('#e9b92c'),
  },
  blanco: {
    ...BASE, fur: '#f6f3ec', earInner: '#f0a8ae', earInnerOpacity: 0.9, earFur: '#ffffff',
    muzzle: null, blaze: null, nose: '#f0a0a8', whisker: '#b9b2a6', whiskerOpacity: 0.9, eyes: ['#6fb4e3', '#e7b53a'],
  },
  gris: {
    ...BASE, fur: '#8995a3', earInner: '#c49aa3', earInnerOpacity: 0.65, earFur: '#b8c1cb', earFurOpacity: 0.6,
    muzzle: muzzle('#9aa5b2', 112, 86, 55), blaze: null, nose: '#6b7380', eyes: both('#e59a33'), outline: '#1d232b',
  },
  atigrado: {
    ...BASE, fur: '#8f7255', earInner: '#d79a92', earFur: '#e6d6bf',
    muzzle: muzzle('#eadcc4', 112, 86, 55), blaze: null, nose: '#c27466', eyes: both('#9fb446'),
    stripes: { color: '#2c2017', opacity: 0.9, forehead: true }, outline: '#1b130c',
  },
  'atigrado-gris': {
    ...BASE, fur: '#9a9a96', earInner: '#d79a92', earFur: '#eeeeea',
    muzzle: muzzle('#eeeeea', 112, 86, 55), blaze: null, nose: '#c98a8e', eyes: both('#a9c255'),
    stripes: { color: '#262626', opacity: 0.9, forehead: true }, outline: '#141414',
  },
  siames: {
    ...BASE, fur: '#efe2cc', earL: SEAL, earR: SEAL, earInner: '#7a4a3c', earInnerOpacity: 0.55, earFur: null,
    muzzle: null, blaze: null, nose: '#2e1a14', eyes: both('#5fa9e6'), mask: SEAL, outline: '#2a1a12',
  },
  calico: {
    ...BASE, fur: '#f7f3ea', earL: ORANGE, earR: '#1c1a19', earInner: '#eda39b', earFur: CREAM,
    muzzle: muzzle('#f7f3ea'), blaze: blaze('#f7f3ea', 40, 104), nose: '#f0a0a8', whisker: '#b9b2a6', eyes: both('#c9b347'),
    patches: [
      patch('rounded', -62, -46, 118, 92, -18, ORANGE),
      patch('ellipse', -88, 20, 60, 70, 10, ORANGE),
      patch('rounded', 70, -52, 104, 84, 22, '#1c1a19'),
      patch('ellipse', 98, 22, 44, 56, -12, '#1c1a19'),
      patch('ellipse', 74, -10, 40, 30, 15, ORANGE),
    ],
  },
}

/** Iris colours for a coat with these eyes (viewer's left, right). */
export function irisColors(coat: StinkyCoat, eyes: StinkyEyes): readonly [string, string] {
  if (eyes === 'natural') return COAT_LOOKS[coat].eyes
  const c = stinkyEyeColor(coat, eyes)
  return [c, c]
}
export const DARK_OUTLINE = { color: '#f5efe6', width: 6, opacity: 1 } as const
export const LIGHT_OUTLINE_WIDTH = 4
export const PUPIL_COLOR = '#0a0a0a'
export const MOUTH_PINK = '#d97f8c'

// ---------------------------------------------------------------------------------------------- clips

type Ease = 'io' | 'o' | 'i'
/** [atMs, easing, eyeHeight, faceRotation, leftEyeRotation, rightEyeRotation, gap, pitch, yaw, positionX, positionY, extra?] */
type Key = readonly [number, Ease, number, number, number, number, number, number, number, number, number, KeyExtra?]
interface KeyExtra {
  /** Per-eye height (wink, squint). */
  lh?: number
  rh?: number
  /** Colour grade [brightness, saturation]. */
  grade?: readonly [number, number]
  /** The wave paw: [rotationZ, scale, x, y] (scene units). */
  paw?: readonly [number, number, number, number]
}
const N: Key = [0, 'io', 36, 0, -14, 14, 48, 0, -0.12, 0, 18]
const HIDDEN_PAW = [0, 0.0588, 60, 40] as const

/** `stinky.animations.json`, clip by clip (checked against the file by tests/stinky-svg.test.tsx). */
export const CLIP_KEYS: Readonly<Record<StinkyState, readonly Key[]>> = {
  idle: [
    N,
    [640, 'io', 36, -1, -14, 14, 48, -0.016, -0.082, 0, 16],
    [1344, 'io', 36, 1, -14, 14, 48, 0.014, -0.166, 0, 19],
    [1472, 'io', 28.08, 0, -14, 14, 48, -0.006, -0.14, 0, 17],
    [1600, 'io', 7, 0, -14, 14, 48, 0, -0.135, 0, 17],
    [1728, 'io', 28.08, 0, -14, 14, 48, 0, -0.13, 0, 17],
    [2304, 'io', 36, 0, -14, 14, 48, -0.01, -0.095, 0, 16],
    [2816, 'io', 36, 0, -14, 14, 48, 0.008, -0.138, 0, 19],
    [3200, 'io', 36, 0, -14, 14, 48, 0, -0.12, 0, 18],
  ],
  thinking: [
    N,
    [576, 'io', 20.88, -7, -25, 18, 55, -0.11, 0.04, 3, 14],
    [1536, 'io', 18.79, -4, -20, 23, 52, -0.15, 0.1, 5, 13],
    [2368, 'io', 20.88, -7, -25, 18, 55, -0.1, 0.02, 2, 15],
    [2816, 'io', 7, 0, -14, 14, 48, -0.04, -0.06, 0, 18],
    [3200, 'io', 36, 0, -14, 14, 48, 0, -0.12, 0, 18],
  ],
  happy: [
    N,
    [576, 'io', 28.08, 0, -14, 14, 48, -0.04, -0.18, 0, 10],
    [1536, 'io', 28.08, 0, -14, 14, 48, 0.025, -0.07, 0, 19],
    [1856, 'io', 9.8, 0, -14, 14, 48, 0, -0.12, 0, 16],
    [2176, 'io', 28.08, 0, -14, 14, 48, 0, -0.15, 0, 13],
    [2752, 'io', 28.08, 0, -14, 14, 48, 0.015, -0.12, 0, 18],
    [3200, 'io', 36, 0, -14, 14, 48, 0, -0.12, 0, 18],
  ],
  wave: [
    [0, 'io', 36, 0, -14, 14, 48, 0, -0.12, 0, 18, { lh: 36, paw: HIDDEN_PAW }],
    [380, 'o', 36, 0, -14, 14, 48, 0, -0.18, 0, 18, { lh: 36, paw: [-10, 1, 116, 10] }],
    [640, 'io', 36, 0, -14, 14, 48, 0, -0.22, 0, 18, { lh: 7, paw: [30, 1, 124, 4] }],
    [900, 'io', 36, 0, -14, 14, 48, 0, -0.22, 0, 18, { lh: 7, paw: [-30, 1, 108, 4] }],
    [1160, 'io', 36, 0, -14, 14, 48, 0, -0.22, 0, 18, { lh: 7, paw: [30, 1, 124, 4] }],
    [1420, 'io', 36, 0, -14, 14, 48, 0, -0.2, 0, 18, { lh: 7, paw: [-30, 1, 108, 4] }],
    [1680, 'io', 36, 0, -14, 14, 48, 0, -0.18, 0, 18, { lh: 36, paw: [20, 1, 121, 6] }],
    [2100, 'i', 36, 0, -14, 14, 48, 0, -0.12, 0, 18, { lh: 36, paw: HIDDEN_PAW }],
    [2550, 'io', 36, 0, -14, 14, 48, 0, -0.12, 0, 18, { lh: 36, paw: HIDDEN_PAW }],
  ],
  sleepy: [
    N,
    [576, 'io', 10.8, -4, -14, 14, 48, 0.08, -0.22, 0, 22],
    [2304, 'io', 9, 3, -14, 14, 48, 0.12, -0.02, 0, 25],
    [3200, 'io', 36, 0, -14, 14, 48, 0, -0.12, 0, 18],
  ],
  sad: [
    [0, 'io', 36, 0, -14, 14, 48, 0, -0.12, 0, 18, { grade: [1, 1] }],
    [704, 'io', 20.16, -5, -7, 7, 48, 0.1, -0.18, 0, 24, { grade: [0.84, 0.56] }],
    [1536, 'io', 10.5, -5, -7, 7, 48, 0.12, -0.12, 0, 26, { grade: [0.84, 0.56] }],
    [1792, 'io', 20.16, -5, -7, 7, 48, 0.11, -0.08, 0, 25, { grade: [0.84, 0.56] }],
    [2560, 'io', 20.16, -5, -7, 7, 48, 0.08, -0.15, 0, 23, { grade: [0.84, 0.56] }],
    [3200, 'io', 36, 0, -14, 14, 48, 0, -0.12, 0, 18, { grade: [1, 1] }],
  ],
  purr: [
    N,
    [450, 'io', 16.2, -3, -14, 14, 48, 0.04, -0.17, -2, 19],
    [800, 'o', 3, -6, -14, 14, 48, 0.07, -0.21, -4, 20],
    [1950, 'io', 3, -6, -14, 14, 48, 0.07, -0.21, -4, 20],
    [2250, 'io', 21.6, -2, -14, 14, 48, 0.02, -0.15, -1, 19],
    [2450, 'o', 36, 0, -14, 14, 48, 0, -0.12, 0, 18],
  ],
  bite: [
    [0, 'io', 36, 0, -14, 14, 48, 0, -0.12, 0, 18, { lh: 36, rh: 36 }],
    [220, 'o', 36, -3, -24, 22, 48, 0.07, -0.22, -3, 21, { lh: 12.96, rh: 18 }],
    [520, 'io', 36, -3, -24, 22, 48, 0.11, -0.22, -3, 21, { lh: 12.96, rh: 18 }],
    [700, 'io', 36, -3, -24, 22, 48, 0.06, -0.22, -3, 21, { lh: 12.96, rh: 18 }],
    [870, 'io', 36, -3, -24, 22, 48, 0.11, -0.22, -3, 21, { lh: 12.96, rh: 18 }],
    [1100, 'io', 36, -3, -24, 22, 48, 0.07, -0.22, -3, 21, { lh: 12.96, rh: 18 }],
    [1350, 'io', 36, 0, -14, 14, 48, 0, -0.12, 0, 18, { lh: 36, rh: 36 }],
  ],
}

/**
 * What the 3D scene could not do and the rig can: ears [atMs, left°, right°] (negative left /
 * positive right tilt outward) and pupils [atMs, dx, dy, dilation]. Linear in between, neutral
 * at both ends like everything else.
 */
export const EAR_KEYS: Readonly<Partial<Record<StinkyState, ReadonlyArray<readonly [number, number, number]>>>> = {
  idle: [[2304, 0, 0], [2400, -7, 0], [2520, 0, 0]],
  thinking: [[0, 0, 0], [576, -6, 2], [2368, -6, 2], [2816, 0, 0]],
  happy: [[0, 0, 0], [576, 4, -4], [2752, 4, -4], [3200, 0, 0]],
  sleepy: [[0, 0, 0], [576, -6, 6], [2304, -7, 7], [3200, 0, 0]],
  sad: [[0, 0, 0], [704, -12, 12], [2560, -12, 12], [3200, 0, 0]],
  purr: [[0, 0, 0], [450, -5, 5], [2250, -5, 5], [2450, 0, 0]],
  bite: [[0, 0, 0], [220, -9, 9], [1100, -9, 9], [1350, 0, 0]],
}
export const PUPIL_KEYS: Readonly<Partial<Record<StinkyState, ReadonlyArray<readonly [number, number, number, number]>>>> = {
  idle: [[0, 0, 0, 1], [640, 1, 0.3, 1], [1344, -1.2, 0, 1], [1472, 0, 0, 1], [2304, 0.6, 0, 1], [2816, -0.6, 0.3, 1], [3200, 0, 0, 1]],
  thinking: [[0, 0, 0, 1], [576, 1.5, -2.5, 1], [1536, 2, -3, 1], [2368, 1.5, -2.5, 1], [2816, 0, 0, 1]],
  happy: [[0, 0, 0, 1], [576, 0, 0, 2.3], [2752, 0, 0, 2.3], [3200, 0, 0, 1]],
  sleepy: [[0, 0, 0, 1], [576, 0, 1.5, 1], [2304, 0, 1.5, 1], [3200, 0, 0, 1]],
  sad: [[0, 0, 0, 1], [704, 0, 2, 1.4], [2560, 0, 2, 1.4], [3200, 0, 0, 1]],
  bite: [[0, 0, 0, 1], [220, 0, 0, 1.6], [1100, 0, 0, 1.6], [1350, 0, 0, 1]],
}

export interface Pose {
  h: number
  rot: number
  lr: number
  rr: number
  gap: number
  pitch: number
  yaw: number
  x: number
  y: number
  lh: number
  rh: number
  grade: readonly [number, number]
  paw: readonly [number, number, number, number]
  earL: number
  earR: number
  pupil: readonly [number, number, number]
}

export const NEUTRAL_POSE: Pose = {
  h: 36, rot: 0, lr: -14, rr: 14, gap: 48, pitch: 0, yaw: -0.12, x: 0, y: 18, lh: 36, rh: 36,
  grade: [1, 1], paw: HIDDEN_PAW, earL: 0, earR: 0, pupil: [0, 0, 1],
}

const EASE: Record<Ease, readonly [number, number, number, number]> = { io: [0.42, 0, 0.58, 1], o: [0, 0, 0.58, 1], i: [0.42, 0, 1, 1] }
export const EASE_CSS: Record<Ease, string> = { io: 'ease-in-out', o: 'ease-out', i: 'ease-in' }

/** y of a CSS cubic-bezier at progress x (bisection: plenty for a pose). */
export function bezier([x1, y1, x2, y2]: readonly [number, number, number, number], x: number): number {
  if (x <= 0) return 0
  if (x >= 1) return 1
  const at = (a: number, b: number, t: number) => 3 * (1 - t) * (1 - t) * t * a + 3 * (1 - t) * t * t * b + t * t * t
  let lo = 0
  let hi = 1
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2
    if (at(x1, x2, mid) < x) lo = mid
    else hi = mid
  }
  return at(y1, y2, (lo + hi) / 2)
}

const keyPose = (k: Key): Pose => ({
  h: k[2], rot: k[3], lr: k[4], rr: k[5], gap: k[6], pitch: k[7], yaw: k[8], x: k[9], y: k[10],
  lh: k[11]?.lh ?? k[2], rh: k[11]?.rh ?? k[2],
  grade: k[11]?.grade ?? [1, 1], paw: k[11]?.paw ?? HIDDEN_PAW, earL: 0, earR: 0, pupil: [0, 0, 1],
})
const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const lerpN = <T extends readonly number[]>(a: T, b: T, t: number) => a.map((v, i) => lerp(v, b[i]!, t)) as unknown as T

/** Where a clip is at `ms` (loops wrap; one-shots hold their last frame). */
export function poseAt(state: StinkyState, ms: number): Pose {
  const { durationMs, playback } = STINKY_STATE_META[state]
  const t = playback === 'loop' ? ((ms % durationMs) + durationMs) % durationMs : Math.max(0, Math.min(ms, durationMs))
  const keys = CLIP_KEYS[state]
  let pose: Pose = keyPose(keys[keys.length - 1]!)
  for (let i = 0; i + 1 < keys.length; i++) {
    const a = keys[i]!
    const b = keys[i + 1]!
    if (t < a[0]) {
      pose = keyPose(a)
      break
    }
    if (t < b[0]) {
      const u = bezier(EASE[a[1]], (t - a[0]) / (b[0] - a[0]))
      const pa = keyPose(a)
      const pb = keyPose(b)
      pose = {
        h: lerp(pa.h, pb.h, u), rot: lerp(pa.rot, pb.rot, u), lr: lerp(pa.lr, pb.lr, u), rr: lerp(pa.rr, pb.rr, u),
        gap: lerp(pa.gap, pb.gap, u), pitch: lerp(pa.pitch, pb.pitch, u), yaw: lerp(pa.yaw, pb.yaw, u),
        x: lerp(pa.x, pb.x, u), y: lerp(pa.y, pb.y, u), lh: lerp(pa.lh, pb.lh, u), rh: lerp(pa.rh, pb.rh, u),
        grade: lerpN(pa.grade, pb.grade, u), paw: lerpN(pa.paw, pb.paw, u), earL: 0, earR: 0, pupil: [0, 0, 1],
      }
      break
    }
  }
  const ears = sample(EAR_KEYS[state], t, [0, 0])
  const pupil = sample(PUPIL_KEYS[state], t, [0, 0, 1])
  return { ...pose, earL: ears[0]!, earR: ears[1]!, pupil: [pupil[0]!, pupil[1]!, pupil[2]!] }
}

function sample<T extends readonly number[]>(keys: ReadonlyArray<readonly [number, ...number[]]> | undefined, t: number, neutral: T): T {
  if (!keys?.length) return neutral
  const at = (k: readonly [number, ...number[]]) => k.slice(1) as unknown as T
  if (t <= keys[0]![0]) return keys[0]![0] === 0 ? at(keys[0]!) : neutral
  for (let i = 0; i + 1 < keys.length; i++) {
    const a = keys[i]!
    const b = keys[i + 1]!
    if (t < b[0]) return lerpN(at(a), at(b), bezier(EASE.io, (t - a[0]) / (b[0] - a[0])))
  }
  return neutral
}

// ---------------------------------------------------------------------------------------------- transforms

export type RigPart = 'head' | 'skull' | 'face' | 'eyeL' | 'eyeR' | 'pupilL' | 'pupilR' | 'earL' | 'earR' | 'paw'
const f = (n: number) => Math.round(n * 1000) / 1000

/** The transform of every animated group for a pose, as CSS (`px`/`deg`) or as SVG attribute syntax. */
export function poseTransforms(p: Pose, css = true): Record<RigPart, string> {
  const u = css ? 'px' : ''
  const d = css ? 'deg' : ''
  const sep = css ? ', ' : ' '
  const tr = (x: number, y: number) => `translate(${f(x)}${u}${sep}${f(y)}${u})`
  const rot = (a: number) => `rotate(${f(a)}${d})`
  const sc = (x: number, y: number) => `scale(${f(x)}${sep}${f(y)})`
  const gapShift = 0.365 * (p.gap - EYES.baseGap)
  const dyaw = p.yaw - NEUTRAL_YAW
  const eye = (side: 'left' | 'right', eyeRot: number, h: number) =>
    `${tr(side === 'left' ? -gapShift : gapShift, 0)} ${rot(EYES[side].rot + (side === 'left' ? eyeRot + EYES.baseRot : eyeRot - EYES.baseRot))} ${sc(1 - EYE_SQUASH * Math.max(0, side === 'left' ? -dyaw : dyaw), h / EYES.openHeight)}`
  const [pr, ps, px, py] = p.paw
  return {
    head: tr(p.x, p.y - VIEW.posY),
    skull: `${tr(SKULL.shift * dyaw, SKULL.shift * p.pitch)} ${rot(SKULL.rot * p.rot)}`,
    face: `${tr((FACE_SHIFT - SKULL.shift) * dyaw, (FACE_SHIFT - SKULL.shift) * p.pitch)} ${rot((1 - SKULL.rot) * p.rot)}`,
    eyeL: eye('left', p.lr, p.lh),
    eyeR: eye('right', p.rr, p.rh),
    pupilL: `${tr(p.pupil[0], p.pupil[1])} ${sc(p.pupil[2], 1)}`,
    pupilR: `${tr(p.pupil[0], p.pupil[1])} ${sc(p.pupil[2], 1)}`,
    earL: rot(p.earL),
    earR: rot(p.earR),
    paw: `${tr(PAW.k * (px - PAW.baseX), PAW.k * (py - PAW.baseY))} ${rot(pr)} ${sc(ps, ps)}`,
  }
}
/** The sad colour grade. The SDK dims the fur, not the white muzzle: a filter over everything is softened to match. */
export const gradeFilter = ([b, s]: readonly [number, number]) => `brightness(${f(1 - (1 - b) * 0.4)}) saturate(${f(s)})`
/** The paw is drawn only while it is out (it rests folded away at scale 0.06, which would still show its outline). */
export const pawOpacity = (p: Pose) => (p.paw[1] < 0.3 ? 0 : 1)

/** A Web Animations keyframe (offset, easing and one of transform / opacity / filter). */
export type RigKeyframe = Keyframe
export interface RigTracks {
  parts: Record<RigPart, RigKeyframe[]>
  /** Only for `sad` (the colour grade). */
  grade: RigKeyframe[] | null
  /** Opacity cuts per mouth, only for clips that open the mouth. */
  mouths: Partial<Record<StinkyMouth, RigKeyframe[]>> | null
  durationMs: number
  loop: boolean
}

/**
 * Per-part keyframes of a clip, for `element.animate()`. Every key of the SDK clip becomes one
 * keyframe with its easing; the ear/pupil extras add their own. With `from`, the first keyframe
 * is the pose the rig is in right now, so a switch mid-clip glides into the new clip over its
 * first segment instead of jumping.
 */
export function rigTracks(state: StinkyState, from?: Pose): RigTracks {
  const { durationMs, playback } = STINKY_STATE_META[state]
  const keys = CLIP_KEYS[state]
  const easingAt = (t: number) => {
    let e: Ease = 'io'
    for (const k of keys) if (k[0] <= t) e = k[1]
    return EASE_CSS[e]
  }
  // Each group of parts keeps its own key times, so a clip's easing is never split by an ear flick.
  const groups: Array<[RigPart[], readonly number[]]> = [
    [['head', 'skull', 'face', 'eyeL', 'eyeR', 'paw'], keys.map(k => k[0])],
    [['earL', 'earR'], (EAR_KEYS[state] ?? []).map(k => k[0])],
    [['pupilL', 'pupilR'], (PUPIL_KEYS[state] ?? []).map(k => k[0])],
  ]
  const parts = {} as Record<RigPart, RigKeyframe[]>
  const grade: RigKeyframe[] = []
  for (const [names, ks] of groups) {
    const times = Array.from(new Set<number>([0, durationMs, ...ks])).sort((a, b) => a - b)
    for (const n of names) parts[n] = []
    for (const t of times) {
      const pose = t === 0 && from ? from : poseAt(state, t)
      const tf = poseTransforms(pose)
      const offset = f(t / durationMs)
      const easing = easingAt(t)
      for (const n of names) parts[n].push(n === 'paw' ? { offset, easing, transform: tf[n], opacity: pawOpacity(pose) } : { offset, easing, transform: tf[n] })
      if (names[0] === 'head') grade.push({ offset, easing, filter: gradeFilter(pose.grade) })
    }
  }
  const segments = STINKY_MOUTH_TIMELINE[state]
  let mouths: RigTracks['mouths'] = null
  if (segments?.length) {
    mouths = {}
    const all: StinkyMouth[] = ['neutral', 'open', 'bite', 'bite-half']
    for (const m of all) {
      const edges = Array.from(new Set(segments.flatMap(([a, b]) => [a, b]))).sort((a, b) => a - b)
      const shown = (ms: number) => (segments.find(([a, b]) => ms >= a && ms < b)?.[2] ?? 'neutral') === m
      const kf: RigKeyframe[] = [{ offset: 0, opacity: shown(0) ? 1 : 0 }]
      for (const e of edges) {
        const o = f(e / durationMs)
        kf.push({ offset: o, opacity: shown(e - 1) ? 1 : 0 }, { offset: o, opacity: shown(e) ? 1 : 0 })
      }
      kf.push({ offset: 1, opacity: shown(durationMs - 1) ? 1 : 0 })
      if (kf.some(k => k.opacity !== kf[0]!.opacity)) mouths[m] = kf
    }
  }
  return { parts, grade: state === 'sad' ? grade : null, mouths, durationMs, loop: playback === 'loop' }
}
