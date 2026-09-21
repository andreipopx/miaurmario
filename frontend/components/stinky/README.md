# Stinky (mascot) components

| File | What | Deps |
|---|---|---|
| `stinky.tsx` | `<Stinky state="thinking" />` — pre-rendered animated WebP (still PNG fallback), poster SVG under `prefers-reduced-motion`, dark variant via next-themes | none (ready now) |
| `stinky-live.tsx` | `<StinkyLive state="thinking" />` — renders live with the OneWorks Avatar SDK; degrades to `<Stinky>` on reduced motion, low-end devices or slow frames | needs the SDK (below) |
| `stinky-states.ts` | states, aliases, durations, asset URLs | — |
| `stinky-pupils.ts` | vertical slit pupils for the live renderer (DOM rewrite of the SDK eye highlight) | — |
| `use-stinky-env.ts` | reduced-motion + theme hooks | — |

Assets: `public/brand/stinky/head/` — `anim/*.webp`, `poster/*.svg|png`, `stinky-head[-happy][-dark].avatar.json` (neutral / happy ":3" mouth), `stinky.animations.json`.

States: `idle` (loop), `thinking` (loop), `happy`, `wave`, `sleepy` (loop), `sad`. `once` states settle into `idle` (configurable via `settleTo`).
Aliases: `working`/`curious` → thinking, `surprised`/`laughing`/`celebrate`/`wink` → happy, `error` → sad, `empty` → sleepy, `hello` → wave.

Look: pink ":3" mouth (surface decals, `#d97f8c`), ochre eyes with black vertical slit pupils. The SDK has no pupil
primitive: definitions make the eye highlight black/centred and `stinky-pupils.ts` reshapes it into a slit (the
pre-rendered assets used the same transform), so blinks and winks still close the pupil.

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
