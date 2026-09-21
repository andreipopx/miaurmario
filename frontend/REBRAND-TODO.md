# Redesign follow-ups ("Stinky pop")

The editorial rebrand this file used to track has been replaced by the Stinky pop system
(see `DESIGN-SYSTEM.md`). Known leftovers:

- **Clothing colour names and AI tag values** (`CLOTHING_COLORS`, item tags) are still English strings from
  `lib/types.ts` / the backend. Clothing *types* are translated via the `clothingTypes` namespace.
- **`formatWornAgo` in `lib/utils.ts`** still returns English; the wardrobe grid uses the translated
  `wardrobe.item.wornAgo` instead. Migrate the remaining callers and drop the helper.
- **Social tab**: the dock's 4th tab is "Looks" (`/dashboard/outfits`) until there is a friends feed.
- **Favorite toggle on wardrobe tiles**: the heart is an indicator only; there is no one-tap favourite
  mutation yet.
- **Live mascot**: `components/stinky/stinky-live.tsx` is not wired (needs the OneWorks SDK, see its README).
- **New Stinky art**: when `public/brand/stinky/head/*` is replaced, run `npm run icons` and bump `CACHE`
  in `public/sw.js`.
