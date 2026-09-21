# Stinky (mascot) components

| File | What | Deps |
|---|---|---|
| `stinky.tsx` | `<Stinky state="thinking" />` — pre-rendered animated WebP (512px), seamless state transitions, tap-to-pet (`purr`), poster under `prefers-reduced-motion`, dark variant via next-themes | none (ready now) |
| `stinky-live.tsx` | `<StinkyLive state="thinking" />` — renders live with the OneWorks Avatar SDK; degrades to `<Stinky>` on reduced motion, low-end devices or slow frames | needs the SDK (below) |
| `stinky-states.ts` | states, aliases, durations, likely-next map, asset URLs | — |
| `stinky-purr.ts` | purr micro-vibration (Web Animations API, 25 Hz, ±1–2px) used by both components | — |
| `stinky-pupils.ts` | vertical slit pupils for the live renderer (DOM rewrite of the SDK eye highlight) | — |
| `use-stinky-env.ts` | reduced-motion + theme hooks | — |

Assets: `public/brand/stinky/head/` — `anim/*.webp` (512px; light 20fps, dark 15fps), `poster/*.svg|png`,
`stinky-head[-dark].svg`, `stinky-head[-open][-dark].avatar.json`, `stinky.animations.json`.

States: `idle` (loop), `thinking` (loop), `sleepy` (loop), `happy`, `wave`, `sad`, `purr` (once → back to the previous
state, or `settleTo`, default idle). Aliases: `working`/`curious` → thinking, `surprised`/`laughing`/`celebrate`/`wink`
→ happy, `error` → sad, `empty` → sleepy, `hello` → wave, `pet` → purr.

**Seamless splicing.** Every clip starts and ends on the exact neutral frame (idle frame 0): measured pixel diff 0 for
first/last frames of all 14 WebPs. `<Stinky>` switches states by stacking a second `<img>`: loops that end within 700ms
finish their cycle first (perfect splice); otherwise the new clip fades in over 150ms on top. One-shots hand over to
idle at their last frame. Each play uses a fresh blob URL of a preloaded clip, so animations always restart at frame 0
and nothing flashes; the likely next clips (and `purr` when interactive) are prefetched.

**One mouth, always.** Stinky never shows the ":3" and an open mouth together. `purr` keeps the ":3"; `happy` and
`wave` swap it for an open mouth (dark-rose oval + tongue) inside `STINKY_MOUTH_OPEN_WINDOWS` (happy 300–2950 ms,
wave 200–1900 ms). The swap is a definition swap (`stinky-head[-open][-dark].avatar.json`, identical except the mouth):
the WebPs were rendered in two passes and assembled per frame; `StinkyLive` stacks a second renderer with the open
definition during those clips and shows exactly one of them per tick. First/last frames stay the neutral ":3" frame.

**Petting.** `interactive` (default when `size >= 48`) renders a `<button aria-label="Acariciar a Stinky">`:
click/tap/Enter/Space plays `purr` (eyes close, head tilt, content mouth, 25 Hz micro-vibration), calls
`navigator.vibrate?.([15,30,15,30,15,30,15])` unless reduced motion, fires `onPet`, then returns to the previous state.
Pets are throttled (1.2s, and ignored while purring).

Look (matched to the real Stinky): warm black coat `#151515`, white flame-shaped blaze from the muzzle up the forehead,
white muzzle/chin, amber-green almond eyes `#cdb44e` with black vertical slit pupils, pink nose `#e6a1a6`, pink ":3"
mouth `#d97f8c` (surface decals), large black ears with a subtle
pink/pale-fur inside, thin white whiskers. The SDK has no pupil primitive: definitions make the eye highlight
black/centred and `stinky-pupils.ts` reshapes it into a slit (the pre-rendered assets used the same transform), so
blinks and winks still close the pupil.

## Enabling the live renderer

1. `package.json` → dependencies:
   ```json
   "@oneworks/avatar": "1.0.0-rc.9",
   "@oneworks/avatar-react": "1.0.0-rc.9"
   ```
   The SDK declares `react`/`react-dom` `>=18.3.0` as peers. The repo pins 18.2.0 (it works at runtime,
   verified), but `npm install` will fail with ERESOLVE. Either bump `"react": "^18.3.1"`,
   `"react-dom": "^18.3.1"` (recommended, Next 14.2 supports it) or install with `--legacy-peer-deps`.
2. Remove the `// @ts-nocheck` first line of `stinky-live.tsx`.
3. Use it client-only:
   ```tsx
   const StinkyLive = dynamic(() => import('@/components/stinky/stinky-live'), {
     ssr: false,
     loading: () => <Stinky state="thinking" size={128} />,
   })
   ```

Cost: ~307 KB min / ~90 KB gzip / ~75 KB brotli of JS (renderer + core, React external) plus ~3.5 KB gzip
of JSON, vs ~390 KB per animated WebP state. CPU: ~30 ms of main-thread JS per animation frame on a fast
desktop, ~125 ms at 4x CPU throttling, so `StinkyLive` caps updates (default 24 fps), pauses off-screen and
falls back to the sprite when frames are slow.

Licence: OneWorks Avatar is MIT — commercial use OK; keep the MIT notice with the bundled package code.
