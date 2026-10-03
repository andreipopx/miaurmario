import {
  BarChart3,
  Bell,
  Brain,
  CalendarDays,
  Camera,
  Compass,
  Home,
  Layers,
  LayoutGrid,
  MessageCircle,
  Music,
  Pin,
  Plug,
  Settings,
  Shirt,
  Sparkles,
  UserRound,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { FEATURES } from '@/lib/features';

/**
 * Information architecture. Four areas live in the mobile dock and the desktop
 * sidebar; every other screen is a tab *inside* one of them (segmented control
 * on mobile, expanded group in the sidebar on desktop). Ajustes is reached from
 * the profile menu only. URLs never changed: this file only decides where each
 * route shows up and which entry lights up for it.
 */

export interface NavItem {
  /** Kept for routing (the page still works) but never rendered in the nav. */
  hidden?: boolean;
  /** Key in the `nav` messages namespace. */
  key: string;
  href: string;
  icon: LucideIcon;
  /** Shows the social badge (pending friend requests + new reactions). */
  socialBadge?: boolean;
}

export interface NavSection extends NavItem {
  /** Shorter label for the dock pill, when the full one does not fit. */
  shortKey?: string;
  /** Sub-pages of the section. Empty = single-screen section. */
  tabs: readonly NavItem[];
}

export const TODAY: NavSection = { key: 'today', href: '/dashboard', icon: Home, tabs: [] };

/**
 * What you own: garments and looks. Everything else that used to live here moved
 * to where it belongs — the AI tools to Stinky, the numbers to "Tu estilo" in the
 * profile menu — but keeps its route, so links and deep links still land.
 */
export const WARDROBE: NavSection = {
  key: 'wardrobe',
  href: '/dashboard/wardrobe',
  icon: Shirt,
  tabs: [
    { key: 'garments', href: '/dashboard/wardrobe', icon: Shirt },
    { key: 'looks', href: '/dashboard/outfits', icon: LayoutGrid },
    // Reached from a garment ("Combinar") and the Looks filter.
    { key: 'pairings', href: '/dashboard/pairings', icon: Layers, hidden: true },
    // "Tu estilo", in the profile menu.
    { key: 'analytics', href: '/dashboard/analytics', icon: BarChart3, hidden: true },
    { key: 'learning', href: '/dashboard/learning', icon: Brain, hidden: true },
  ],
};

/**
 * Stinky is the stylist: one home for everything AI. The chat opens first, with
 * "pídeme un look", "qué llevo" and his inspiration as its first actions.
 */
export const STINKY: NavSection = {
  key: 'stinky',
  shortKey: 'stinkyShort',
  href: '/dashboard/stinky',
  icon: MessageCircle,
  tabs: [
    { key: 'chat', href: '/dashboard/stinky', icon: MessageCircle },
    { key: 'askLook', href: '/dashboard/suggest', icon: Sparkles },
    { key: 'selfie', href: '/dashboard/selfie', icon: Camera },
    { key: 'inspiration', href: '/dashboard/inspiration', icon: Compass },
    // Linked from "Pedir look" (past suggestions) and from Inspiración.
    { key: 'history', href: '/dashboard/history', icon: CalendarDays, hidden: true },
    { key: 'music', href: '/dashboard/music', icon: Music, hidden: true },
    { key: 'pins', href: '/dashboard/pins', icon: Pin, hidden: true },
  ],
};

/** Friends' looks and your friends (groups may come later). */
export const FRIENDS: NavSection = {
  key: 'friends',
  href: '/dashboard/friends',
  icon: Users,
  tabs: [
    { key: 'friends', href: '/dashboard/friends', icon: UserRound, socialBadge: true },
    { key: 'family', href: '/dashboard/family/feed', icon: Users, hidden: !FEATURES.families },
  ],
};

/**
 * Ajustes: reached from the profile menu, never from the dock/sidebar. Admin lives in the profile menu.
 *
 * «Familia» (its feed and its settings) is hidden on purpose (FEATURES.families in
 * lib/features.ts): it overlaps with Amigos and confused people. Its pages send
 * you to Amigos while the flag is off; nothing was deleted.
 */
export const SETTINGS: NavSection = {
  key: 'settings',
  href: '/dashboard/settings',
  icon: Settings,
  tabs: [
    { key: 'general', href: '/dashboard/settings', icon: Settings },
    { key: 'notifications', href: '/dashboard/notifications', icon: Bell },
    { key: 'familySettings', href: '/dashboard/family', icon: Users, hidden: !FEATURES.families },
    { key: 'integrations', href: '/dashboard/settings/integrations', icon: Plug },
  ],
};

/** The dock (mobile) and the sidebar (desktop) show exactly these, in this order. */
export const MAIN_SECTIONS: readonly NavSection[] = [TODAY, WARDROBE, STINKY, FRIENDS];

export const ALL_SECTIONS: readonly NavSection[] = [...MAIN_SECTIONS, SETTINGS];

function matches(pathname: string, href: string): boolean {
  if (href === '/dashboard') return pathname === '/dashboard';
  return pathname === href || pathname.startsWith(href + '/');
}

export interface ResolvedNav {
  section: NavSection;
  /** The tab that owns the path (longest matching href), if the section has tabs. */
  tab?: NavItem;
}

/**
 * Which section/tab owns `pathname`. Longest href wins, so /dashboard/family/feed
 * belongs to Amigos while /dashboard/family belongs to Ajustes, and detail
 * pages (/dashboard/outfits/abc, /dashboard/friends/ana) light up their parent.
 */
export function resolveNav(pathname: string | null | undefined): ResolvedNav | null {
  if (!pathname) return null;
  let best: { section: NavSection; tab?: NavItem; len: number } | null = null;
  for (const section of ALL_SECTIONS) {
    const candidates: { href: string; tab?: NavItem }[] = [
      { href: section.href },
      ...section.tabs.map((tab) => ({ href: tab.href, tab })),
    ];
    for (const c of candidates) {
      if (matches(pathname, c.href) && (!best || c.href.length > best.len)) {
        best = { section, tab: c.tab, len: c.href.length };
      }
    }
  }
  if (!best) return null;
  const tab = best.tab ?? best.section.tabs.find((t) => t.href === best!.section.href);
  return { section: best.section, tab };
}

export function isSectionActive(pathname: string | null | undefined, section: NavSection): boolean {
  return resolveNav(pathname)?.section.key === section.key;
}

/** True when `pathname` is exactly one of a section's tab roots (where the tab strip shows). */
export function isTabRoot(pathname: string, section: NavSection): boolean {
  return section.tabs.some((t) => t.href === pathname);
}

/**
 * Top-level screens of the dock sections: no in-app back button there. Hidden
 * tabs (Combinaciones, Música, Tu estilo…) are reached from inside a screen, so
 * they get one.
 */
export const TOP_LEVEL_PATHS: ReadonlySet<string> = new Set(
  MAIN_SECTIONS.flatMap((s) => [s.href, ...s.tabs.filter((t) => !t.hidden).map((t) => t.href)])
);
