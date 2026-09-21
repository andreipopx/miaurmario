import {
  BarChart3,
  Bell,
  Brain,
  CalendarDays,
  Home,
  Layers,
  LayoutGrid,
  Pin,
  Settings,
  Shirt,
  Sparkles,
  UserRound,
  Users,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  /** Key in the `nav` messages namespace. */
  key: string;
  href: string;
  icon: LucideIcon;
  /** Shows the social badge (pending friend requests + new reactions). */
  socialBadge?: boolean;
}

const LOOKS_ITEM: NavItem = { key: 'looks', href: '/dashboard/outfits', icon: LayoutGrid };

/** The four tabs of the floating mobile dock (Looks lives in the profile menu). */
export const DOCK_ITEMS: readonly NavItem[] = [
  { key: 'today', href: '/dashboard', icon: Home },
  { key: 'wardrobe', href: '/dashboard/wardrobe', icon: Shirt },
  { key: 'stylist', href: '/dashboard/suggest', icon: Sparkles },
  { key: 'friends', href: '/dashboard/friends', icon: UserRound, socialBadge: true },
];

/** Every section, for the desktop sidebar and the mobile profile menu. */
export const PRIMARY_ITEMS: readonly NavItem[] = [
  ...DOCK_ITEMS.slice(0, 3),
  LOOKS_ITEM,
  DOCK_ITEMS[3],
  { key: 'pairings', href: '/dashboard/pairings', icon: Layers },
  { key: 'pins', href: '/dashboard/pins', icon: Pin },
  { key: 'history', href: '/dashboard/history', icon: CalendarDays },
  { key: 'family', href: '/dashboard/family/feed', icon: Users },
  { key: 'analytics', href: '/dashboard/analytics', icon: BarChart3 },
  { key: 'learning', href: '/dashboard/learning', icon: Brain },
];

export const SECONDARY_ITEMS: readonly NavItem[] = [
  { key: 'familySettings', href: '/dashboard/family', icon: Users },
  { key: 'notifications', href: '/dashboard/notifications', icon: Bell },
  { key: 'settings', href: '/dashboard/settings', icon: Settings },
];

export function isActivePath(pathname: string, href: string): boolean {
  if (href === '/dashboard') return pathname === '/dashboard';
  return pathname === href || pathname.startsWith(href + '/');
}

/** Secondary items only light up when no primary item claims the path (e.g. /dashboard/family/feed). */
export function isSecondaryActive(pathname: string, href: string): boolean {
  return isActivePath(pathname, href) && !PRIMARY_ITEMS.some((p) => isActivePath(pathname, p.href));
}
