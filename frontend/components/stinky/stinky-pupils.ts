/**
 * Stinky's vertical cat-slit pupils for the live OneWorks renderer.
 *
 * The SDK has no pupil primitive. Stinky's definitions turn the eye highlight black and centred,
 * and this rewrites each highlight path into a narrow, tall ellipse. Only the path `d` changes, so
 * the SDK's eye clip-path still applies and blinks/winks close the pupil.
 * The pre-rendered assets in /public/brand/stinky/head were produced with the same transform.
 */

const SLIT_X = 0.36
const SLIT_Y = 1.9
const SEGMENTS = 40

export function slitPupilPath(d: string): string {
  const nums = d.match(/-?\d+(?:\.\d+)?/g)
  if (!nums || nums.length < 6) return d
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (let i = 0; i + 1 < nums.length; i += 2) {
    const x = Number(nums[i])
    const y = Number(nums[i + 1])
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
  const cx = (minX + maxX) / 2
  const cy = (minY + maxY) / 2
  const r = Math.max(maxX - minX, maxY - minY) / 2
  const points: string[] = []
  for (let k = 0; k < SEGMENTS; k++) {
    const a = (k / SEGMENTS) * Math.PI * 2
    const c = Math.cos(a)
    const px = cx + r * SLIT_X * Math.sign(c) * Math.abs(c) ** 1.35
    const py = cy + r * SLIT_Y * Math.sin(a)
    points.push(`${px.toFixed(3)} ${py.toFixed(3)}`)
  }
  return `M ${points.join(' L ')} Z`
}

const DONE = 'stinkySlit'

export function applySlitPupils(root: ParentNode) {
  root.querySelectorAll<SVGPathElement>('path[data-avatar-eye-highlight]').forEach(path => {
    const d = path.getAttribute('d') ?? ''
    if (path.dataset[DONE] === d) return
    const next = slitPupilPath(d)
    path.dataset[DONE] = next
    path.setAttribute('d', next)
  })
}

/** Keeps pupils slit while the renderer re-renders. Observers run before paint, so there is no flicker. */
export function observeSlitPupils(host: HTMLElement): () => void {
  applySlitPupils(host)
  const observer = new MutationObserver(() => applySlitPupils(host))
  observer.observe(host, { subtree: true, childList: true, attributes: true, attributeFilter: ['d'] })
  return () => observer.disconnect()
}
