// Full shipped-equivalent asset set for one coat: node coat.mjs <presetId> [outRoot=coats]
// -> <outRoot>/<id>/head/{anim,anim-256,poster,still}/stinky-*  + stinky-head[-dark].svg
// Same timings, 20 fps, loop counts and sealing as the shipped Esmoquin assets.
import fs from 'node:fs'
import sharp from 'sharp'
import { open, LIB } from './render.mjs'
import { PRESETS, applyPreset, baseDef, svgHookFor, clipsFor } from './presets.mjs'
import { MOUTHS, BITE_SCALE, mouthAt } from '../pw/raw7.mjs'
import { frameList } from '../pw/enc5.mjs'
import { sealWebp } from '../pw/sealwebp.mjs'
const [,, coatId, outRoot = 'coats', eyeId] = process.argv
// Eye colours offered on top of each coat's own (Ajustes → Tu Stinky). Ids match lib/stinky-persona.ts.
export const EYES = { ambar: '#e2b13a', verde: '#9fb446', azul: '#5fa9e6', cobre: '#e08a2e' }
const base = PRESETS.find(x => x.id === coatId); if (!base) throw new Error('no preset ' + coatId)
if (eyeId && !EYES[eyeId]) throw new Error('no eye ' + eyeId)
const p = eyeId ? { ...base, eye: EYES[eyeId], eyeRight: undefined } : base
const id = eyeId ? `${coatId}--${eyeId}` : coatId
// The tuxedo preset is "no changes"; with other eyes it only recolours the eyes.
const recolourEyes = d => {
  if (!eyeId) return d
  d.scene.entity.parts = d.scene.entity.parts.map(part => (part.face ? { ...part, foregroundColor: EYES[eyeId] } : part))
  return d
}
const CL = clipsFor(p, LIB)
const FILE = { neutral: '', open: '-open', bite: '-bite', 'bite-half': '-bite-half' }
const COVER = { idle: .5, thinking: .35, happy: .45, wave: .4, sleepy: .55, sad: .55, purr: .55, bite: 650 / 1500 }
const LOOP = { idle: 0, thinking: 0, sleepy: 0, happy: 1, wave: 1, sad: 1, purr: 1, bite: 1 }
const FPS = 20
const OUT = `${outRoot}/${id}/head`, RAW = `raw/${id}`
for (const d of ['anim', 'anim-256', 'poster', 'still']) fs.mkdirSync(`${OUT}/${d}`, { recursive: true })
const hook = svgHookFor(p) ?? (s => s)
const presetDef = (mouth, dark) => recolourEyes(applyPreset(baseDef(mouth, dark), p))
const PIVOT = { x: 256, y: 262 }
async function scaleFrame(png, s) {
  const S = Math.round(512 * s)
  const big = await sharp(png).resize(S, S, { kernel: 'lanczos3' }).png().toBuffer()
  return sharp(big).extract({ left: Math.round(PIVOT.x * s - PIVOT.x), top: Math.round(PIVOT.y * s - PIVOT.y), width: 512, height: 512 }).png().toBuffer()
}
async function capture(page) {
  const svg = hook(await page.evaluate(() => window.__captureStyledSvg(512, 'transparent')))
  const png = Buffer.from(await page.evaluate(async svg => {
    const img = new Image(); img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg); await img.decode()
    const c = document.createElement('canvas'); c.width = 512; c.height = 512; c.getContext('2d').drawImage(img, 0, 0, 512, 512)
    return c.toDataURL('image/png').split(',')[1]
  }, svg), 'base64')
  return { svg, png }
}
async function encode(frames, out, size, loop) {
  let bufs = frames.map(f => f[0])
  if (size !== 512) bufs = await Promise.all(bufs.map(b => sharp(b, { raw: { width: 512, height: 512, channels: 4 } }).resize(size, size, { kernel: 'lanczos3' }).raw().toBuffer()))
  await sharp(Buffer.concat(bufs), { raw: { width: size, height: size * bufs.length, channels: 4, pageHeight: size } })
    .webp({ loop, delay: frames.map(f => Math.round(f[1])), quality: 60, alphaQuality: 30, minSize: true, effort: 6 }).toFile(out)
  sealWebp(out)
}
const t00 = Date.now()
const { browser, page } = await open()
for (const variant of ['light', 'dark']) {
  const dark = variant === 'dark', sfx = dark ? '-dark' : ''
  const defs = Object.fromEntries(Object.entries(FILE).map(([k, f]) => [k, presetDef(f, dark)]))
  for (const cid of Object.keys(LIB)) {
    const t0 = Date.now()
    const clip = CL[cid], n = Math.round(clip.durationMs / 1000 * FPS)
    const dir = `${RAW}/${cid}${sfx}`; fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true })
    const mouths = []
    for (const kind of Object.keys(MOUTHS)) {
      const frames = [...Array(n).keys()].filter(k => mouthAt(cid, k * 1000 / FPS) === kind)
      const posterT = Math.round(clip.durationMs * COVER[cid])
      const wantPoster = mouthAt(cid, posterT) === kind
      const wantStatic = cid === 'idle' && kind === 'neutral'
      if (!frames.length && !wantPoster) continue
      await page.evaluate(d => window.__setDef(d), defs[kind]); await page.waitForTimeout(500)
      await page.evaluate(c => { window.__play(c, 'once'); window.__pause() }, clip)
      for (const t of [clip.durationMs / 2, 0]) { await page.evaluate(t => window.__seek(t), t); await page.waitForTimeout(180) }
      if (wantStatic) { const { svg } = await capture(page); fs.writeFileSync(`${OUT}/stinky-head${sfx}.svg`, svg) }
      for (const k of frames) {
        const t = k * 1000 / FPS
        await page.evaluate(t => window.__seek(t), t); await page.waitForTimeout(20)
        let { png } = await capture(page)
        const s = cid === 'bite' ? BITE_SCALE(t) : 1
        if (s !== 1) png = await scaleFrame(png, s)
        fs.writeFileSync(`${dir}/${String(k).padStart(4, '0')}.png`, png)
        mouths[k] = kind
      }
      if (wantPoster) {
        for (const x of [posterT + 1, posterT]) { await page.evaluate(x => window.__seek(x), x); await page.waitForTimeout(120) }
        let { svg, png } = await capture(page)
        if (cid === 'bite') png = await scaleFrame(png, BITE_SCALE(posterT))
        fs.writeFileSync(`${OUT}/poster/stinky-${cid}${sfx}.png`, png)
        fs.writeFileSync(`${OUT}/poster/stinky-${cid}${sfx}.svg`, svg)
      }
      await page.evaluate(() => window.__stop())
    }
    fs.writeFileSync(`${dir}/meta.json`, JSON.stringify({ id: cid, fps: FPS, n, durationMs: clip.durationMs, playback: clip.playback, mouths }))
    const { frames } = await frameList(dir, cid)
    await encode(frames, `${OUT}/anim/stinky-${cid}${sfx}.webp`, 512, LOOP[cid])
    await encode(frames, `${OUT}/anim-256/stinky-${cid}${sfx}.webp`, 256, LOOP[cid])
    if (cid === 'idle') {
      // The still is the encoded clip's own frame 0, so it is pixel-identical to where every clip starts and ends.
      await sharp(`${OUT}/anim/stinky-idle${sfx}.webp`, { page: 0 }).png({ compressionLevel: 9 }).toFile(`${OUT}/still/stinky-neutral${sfx}.png`)
      await sharp(`${OUT}/anim-256/stinky-idle${sfx}.webp`, { page: 0 }).png({ compressionLevel: 9 }).toFile(`${OUT}/still/stinky-neutral${sfx}-256.png`)
    }
    console.log(id, `${cid}${sfx}`.padEnd(14), n, 'frames', ((Date.now() - t0) / 1000).toFixed(0) + 's', Math.round(fs.statSync(`${OUT}/anim/stinky-${cid}${sfx}.webp`).size / 1024) + 'KB')
  }
}
await browser.close()
fs.rmSync(RAW, { recursive: true, force: true })
console.log(id, 'DONE', ((Date.now() - t00) / 60000).toFixed(1), 'min')
