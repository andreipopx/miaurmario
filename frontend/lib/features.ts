/**
 * Features hidden on purpose. Nothing behind these flags was deleted: the
 * components, hooks, data and backend endpoints are all still there, so flipping
 * a flag to `true` brings the feature back.
 *
 * - laundry: "para lavar" tracking (wears since wash, mark as washed, wash
 *   history, wash interval, the "Para lavar" filter and badge). The backend
 *   counterpart is LAUNDRY_TRACKING (backend/app/config.py): turn both on together.
 *   Garment care labels ("lavar a 30°") are not laundry tracking and stay.
 * - families: the family group (create/join, family feed, family ratings on
 *   looks, family invite links). Amigos replaces it; the API is untouched.
 * - svgStinky: draw Stinky as the vector rig (components/stinky/stinky-svg.tsx,
 *   lib/stinky-rig.ts) instead of the pre-rendered WebP clips: <Stinky>,
 *   <LazyStinky>, the static <StinkyAvatar> and the coat swatches all follow it.
 *   On since 2026-10-23; `false` brings the WebP clips back (compare both at
 *   /dashboard/stinky/lab).
 */
export const FEATURES = {
  laundry: false,
  families: false,
  svgStinky: true,
} as const;
