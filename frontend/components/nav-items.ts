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

/**
 * Information architecture. Five areas live in the mobile dock and the desktop
 * sidebar; every other screen is a tab *inside* one of them (segmented control
 * on mobile, expanded group in the sidebar on desktop). Ajustes is reached from
 * the profile menu only. URLs never changed: this file only decides where each
 * route shows up and which entry lights up for it.
 */

export interface NavItem {
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

/** "Tu estilo": the wardrobe and everything built on top of it. */
export const WARDROBE: NavSection = {
  key: 'wardrobe',
  href: '/dashboard/wardrobe',
  icon: Shirt,
  tabs: [
    { key: 'garments', href: '/dashboard/wardrobe', icon: Shirt },
    { key: 'selfie', href: '/dashboard/selfie', icon: Camera },
    { key: 'looks', href: '/dashboard/outfits', icon: LayoutGrid },
    { key: 'pairings', href: '/dashboard/pairings', icon: Layers },
    { key: 'history', href: '/dashboard/history', icon: CalendarDays },
    { key: 'analytics', href: '/dashboard/analytics', icon: BarChart3 },
    { key: 'learning', href: '/dashboard/learning', icon: Brain },
  ],
};

export const STYLIST: NavSection = { key: 'stylist', href: '/dashboard/suggest', icon: Sparkles, tabs: [] };

/** "Inspiración": people and things outside your wardrobe. */
export const INSPO: NavSection = {
  key: 'inspo',
  href: '/dashboard/friends',
  icon: Compass,
  socialBadge: true,
  tabs: [
    { key: 'friends', href: '/dashboard/friends', icon: UserRound, socialBadge: true },
    { key: 'family', href: '/dashboard/family/feed', icon: Users },
    { key: 'music', href: '/dashboard/music', icon: Music },
    { key: 'pins', href: '/dashboard/pins', icon: Pin },
  ],
};

export const STINKY: NavSection = {
  key: 'stinky',
  shortKey: 'stinkyShort',
  href: '/dashboard/stinky',
  icon: MessageCircle,
  tabs: [],
};

/** Ajustes: reached from the profile menu, never from the dock/sidebar. Admin lives in the profile menu. */
export const SETTINGS: NavSection = {
  key: 'settings',
  href: '/dashboard/settings',
  icon: Settings,
  tabs: [
    { key: 'general', href: '/dashboard/settings', icon: Settings },
    { key: 'notifications', href: '/dashboard/notifications', icon: Bell },
    { key: 'integrations', href: '/dashboard/settings/integrations', icon: Plug },
    { key: 'familySettings', href: '/dashboard/family', icon: Users },
  ],
};

/** The dock (mobile) and the sidebar (desktop) show exactly these, in this order. */
export const MAIN_SECTIONS: readonly NavSection[] = [TODAY, WARDROBE, STYLIST, INSPO, STINKY];

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
 * belongs to Inspiración while /dashboard/family belongs to Ajustes, and detail
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

/** Top-level screens of the dock sections: no in-app back button there. */
export const TOP_LEVEL_PATHS: ReadonlySet<string> = new Set(
  MAIN_SECTIONS.flatMap((s) => [s.href, ...s.tabs.map((t) => t.href)])
);
