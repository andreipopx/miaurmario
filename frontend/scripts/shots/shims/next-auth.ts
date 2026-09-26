/**
 * A signed-in session, for scenes that mount components which ask for one.
 *
 * The scenes have no backend by design (see vite.config.mjs): the queries behind
 * them never resolve, which is exactly the "nothing loaded yet" state a screenshot
 * of a chrome-only change wants anyway.
 */
export function useSession() {
  return { data: { accessToken: 'shot' }, status: 'authenticated' as const };
}

export function signIn() {
  return Promise.resolve();
}

export function signOut() {
  return Promise.resolve();
}
