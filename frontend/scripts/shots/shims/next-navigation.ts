/**
 * `next/navigation` outside Next.
 *
 * The garment dialog mounts a pairings dialog that reaches for the app router, which
 * only exists inside Next and throws an invariant if it is not there. Nothing in a
 * screenshot navigates, so a router that does nothing is the whole requirement.
 */
const noop = () => undefined;

export function useRouter() {
  return { push: noop, replace: noop, back: noop, forward: noop, refresh: noop, prefetch: noop };
}

export function usePathname() {
  return '/dashboard/wardrobe';
}

export function useSearchParams() {
  return new URLSearchParams();
}

export function useParams() {
  return {};
}
