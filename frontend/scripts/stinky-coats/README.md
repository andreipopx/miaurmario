# Stinky's coats (Ajustes → Tu Stinky)

Every coat and eye colour is the shipped tuxedo set (`public/brand/stinky/head/`:
`anim/`, `anim-256/`, `poster/`, `still/`, `stinky-head[-dark].svg`) rendered again
with another look: same file names, 20 fps, same timings and loop counts, every clip
sealed to start and end on the neutral frame. The app picks the set with
`stinkyAssetBase(coat, eyes)` in `components/stinky/stinky-states.ts`:

- tuxedo with his own eyes → `/brand/stinky/head` (in git, ships with the app)
- anything else → `/brand/coats/<set>/head`, where `<set>` is `<coat>` (its own
  eyes) or `<coat>--<eyes>` (see `stinkyAssetSet` in `lib/stinky-persona.ts`)

## Why they are not in git

About 9 MB per set and 40 sets (10 coats × own eyes + 4 colours, minus the
duplicates) ≈ 350 MB. A phone only ever downloads its own cat, clip by clip, so
this costs server disk, not app weight. They live on the server in
`~/servicios/wardrowbe/data/coats/` and nginx serves them at `/brand/coats/`
(read-only mount, long cache: the URLs carry `?v=<build id>`).

## Rendering a set

`presets.mjs` holds the coats (colours, stripes and patches as OneWorks Avatar
decals on top of the shipped definitions). `coat.mjs` renders one set:

```
node coat.mjs <coat> <outRoot> [eyes]     # eyes: ambar | verde | azul | cobre
```

It needs the OneWorks Avatar SDK (MIT, `@oneworks/avatar`, or point
`ONEWORKS_AVATAR_DIST` at its `dist/index.js`), its example renderer page served
locally (the `launch()` helper opens it with Playwright), and the helper modules
from the original Stinky bake (`raw7.mjs` mouth timeline, `enc5.mjs` frame list,
`sealwebp.mjs`). ~7 minutes per set on one core.
