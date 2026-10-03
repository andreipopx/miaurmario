# Stinky (mascot) components

| File | What | Deps |
|---|---|---|
| `stinky.tsx` | `<Stinky state="thinking" />` — pre-rendered animated WebP (512px, 256px for small heads), seamless state transitions, tap-to-pet (`purr` or `bite`), poster under `prefers-reduced-motion`, dark variant from the page's theme class, `paused` | none (ready now) |
| `stinky-live.tsx` | `<StinkyLive state="thinking" />` — renders live with the OneWorks Avatar SDK; degrades to `<Stinky>` on reduced motion, low-end devices or slow frames | needs the SDK (below) |
| `stinky-states.ts` | states, aliases, durations, likely-next map, asset URLs | — |
| `stinky-pet.ts` | pet reaction picker (~65% purr / ~35% bite, never 3 bites in a row) + haptic patterns | — |
| `stinky-purr-fx.tsx` / `stinky-bite-fx.tsx` | hearts + "prrr" / "¡ñam!" + tooth-mark overlays shown on pet | — |
| `stinky-purr.ts` | purr micro-vibration (Web Animations API, 25 Hz, ±1–2px) used by both components | — |
| `stinky-pupils.ts` | vertical slit pupils for the live renderer (DOM rewrite of the SDK eye highlight) | — |
| `use-stinky-env.ts` | reduced-motion + theme hooks | — |

Assets: `public/brand/stinky/head/` — `anim/*.webp` (512px, 20fps), `anim-256/*.webp` (the same clips at 256px, for
sizes ≤ 85), `still/stinky-neutral[-dark][-256].png` (frame 0 decoded from the clips), `poster/*.svg|png`,
`stinky-head[-dark].svg`, `stinky-head[-open|-bite|-bite-half][-dark].avatar.json`, `stinky.animations.json`.

**Cache-busting.** Every asset URL from `stinky-states.ts` (WebPs, posters, PNG fallbacks, avatar JSON) carries
`?v=${NEXT_PUBLIC_BUILD_ID}`, so a deploy never serves stale clips from the browser, CDN or service-worker cache. Always
build Stinky URLs through those helpers.

States: `idle` (loop), `thinking` (loop), `sleepy` (loop), `happy`, `wave`, `sad`, `purr` / `bite` (once → back to the previous
state, or `settleTo`, default idle). Aliases: `working`/`curious` → thinking, `surprised`/`laughing`/`celebrate`/`wink`
→ happy, `error` → sad, `empty` → sleepy, `hello` → wave, `pet` → purr, `nibble`/`chomp` → bite.

**Seamless splicing.** Every clip starts and ends on the exact neutral frame (idle frame 0): first and last frames
are pixel-identical in all 32 WebPs. Loops repeat forever; one-shots (wave, happy, sad, purr, bite) have loop count 1,
so they rest on that frame when done. Under everything sits a still of that frame (`still/`, decoded from the clips,
light and dark picked by CSS before any script runs), so a clip starts on exactly the picture already on screen.

A switch fetches the next clip, decodes it (`img.decode()`), then waits for the playing clip to reach its neutral
frame — the end of a loop (cut 70 ms before it), or the end of a one-shot — and *cuts*: the new layer goes up and,
the moment it has loaded, everything under it is hidden (so soft edges are never drawn twice and there is never an
empty frame). A change of look (light ↔ dark) always cross-fades. Only when that frame is more than 900 ms away (350 ms for a pet)
does it cross-fade instead: the new layer fades in over the old one (140 ms), then the old one fades out (110 ms).
A clip's clock starts on the frame it is first shown; every timer belongs to one switch and is dropped when a newer
one starts. Each play uses a fresh blob URL, so animations always restart at frame 0. A one-shot that stays on screen
when it finishes (`settleTo={null}`) hands over to the still, so nothing depends on how a decoder ends a clip.

**One mouth, always.** Stinky never shows the ":3" and an open mouth together. `purr` keeps the ":3"; `happy` and
`wave` swap it for an open mouth (dark-rose oval + tongue), and `bite` for a fanged open mouth / half-closed "ñam"
mouth, following `STINKY_MOUTH_TIMELINE` (happy 300–2950 ms, wave 200–1900 ms, bite 120–1150 ms). The swap is a definition swap (`stinky-head[-open][-dark].avatar.json`, identical except the mouth):
the WebPs were rendered in two passes and assembled per frame; `StinkyLive` stacks a second renderer with the open
definition during those clips and shows exactly one of them per tick. First/last frames stay the neutral ":3" frame.

**Petting.** `interactive` (default when `size >= 48`) renders a `<button aria-label="Acariciar a Stinky">`:
click/tap/Enter/Space plays `purr` (~65%: eyes close, head tilt, content mouth, 25 Hz micro-vibration, hearts + "prrr") or `bite` (~35%:
lean-in, two playful chomps, "¡ñam!" + tooth marks), buzzes the phone through `haptic()` (`lib/native/haptics.ts`:
`navigator.vibrate` on Android, the hidden iOS 17.4+ `<input type="checkbox" switch>` tap otherwise, nothing with
reduced motion), fires `onPet(reaction)`, then returns to the previous state. Pets are throttled (1.2s, and ignored
while reacting). A one-shot requested during a pet plays after it; one the pet interrupted counts as played
(`onDone` fires).

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
