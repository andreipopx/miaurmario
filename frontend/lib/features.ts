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
 */
export const FEATURES = {
  laundry: false,
  families: false,
} as const;
