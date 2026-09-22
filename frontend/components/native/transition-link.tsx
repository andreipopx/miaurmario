'use client';

import { forwardRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { navigateWithTransition, supportsViewTransitions } from '@/lib/native/view-transition';

type LinkProps = React.ComponentPropsWithoutRef<typeof Link>;

/**
 * next/link that cross-fades with a View Transition where supported
 * (tab switches, list → detail). Falls back to a plain Link: modified clicks,
 * new tabs, prefetching and a11y all behave exactly like <Link>.
 */
export const TransitionLink = forwardRef<HTMLAnchorElement, LinkProps>(function TransitionLink(
  { onClick, href, replace, scroll, ...props },
  ref
) {
  const router = useRouter();
  return (
    <Link
      ref={ref}
      href={href}
      replace={replace}
      scroll={scroll}
      onClick={(e) => {
        onClick?.(e);
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        if (props.target && props.target !== '_self') return;
        if (!supportsViewTransitions()) return;
        e.preventDefault();
        const url = typeof href === 'string' ? href : href.pathname ?? '/';
        navigateWithTransition(() =>
          replace ? router.replace(url, { scroll: scroll ?? true }) : router.push(url, { scroll: scroll ?? true })
        );
      }}
      {...props}
    />
  );
});
