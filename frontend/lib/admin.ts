// Site-admin panel types + pure helpers (unit-tested without React).

import type { AdminUser } from '@/lib/ai-access';

export type AdminTab = 'summary' | 'users' | 'signup' | 'inbox' | 'system';
export const ADMIN_TABS: readonly AdminTab[] = ['summary', 'users', 'signup', 'inbox', 'system'];

export function parseAdminTab(value: string | null | undefined): AdminTab {
  return ADMIN_TABS.includes(value as AdminTab) ? (value as AdminTab) : 'summary';
}

export interface AIPricing {
  input_usd_per_m: number;
  output_usd_per_m: number;
  usd_eur_rate: number;
  monthly_budget_eur: number | null;
}

export type BudgetLevel = 'ok' | 'warning' | 'exceeded';

export interface AdminOverview {
  users_total: number;
  active_7d: number;
  active_30d: number;
  new_7d: number;
  signups_by_day: { date: string; count: number }[];
  onboarding_completed: number;
  onboarding_pct: number;
  items_total: number;
  outfits_total: number;
  ai: {
    month: string;
    requests: number;
    tokens: number;
    input_tokens: number;
    output_tokens: number;
    unsplit_tokens: number;
    cost_usd: number;
    cost_eur: number;
    pricing: AIPricing;
    budget_level: BudgetLevel;
    budget_used_pct: number | null;
    top_users: {
      id: string;
      username: string | null;
      display_name: string;
      ai_access: string;
      requests: number;
      tokens: number;
      input_tokens: number;
      output_tokens: number;
      cost_eur: number;
    }[];
  };
}

export interface AdminUserDetail extends AdminUser {
  onboarding_completed: boolean;
  has_password: boolean;
  outfit_count: number;
  friend_count: number | null;
  spotify_connected: boolean;
  pinterest_connected: boolean;
  input_tokens_this_month: number;
  output_tokens_this_month: number;
  cost_eur_this_month: number;
  deletion_status: string | null;
}

export interface AccountDeletion {
  id: string;
  user_id: string;
  username: string | null;
  status: 'pending' | 'running' | 'done' | 'failed';
  error: string | null;
  summary: Record<string, unknown>;
  requested_at: string;
  completed_at: string | null;
}

export type SignupMode = 'open' | 'invite_only';

export interface Invite {
  id: string;
  code: string;
  note: string | null;
  max_uses: number | null;
  uses: number;
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string;
  status: 'active' | 'revoked' | 'expired' | 'used_up';
  link: string;
  /** Set on waitlist invites: only this email can use it. */
  email?: string | null;
}

export type WaitlistStatus = 'pending' | 'approved' | 'rejected';

export interface WaitlistItem {
  id: string;
  email: string;
  name: string | null;
  message: string | null;
  locale: string;
  status: WaitlistStatus;
  created_at: string;
  decided_at: string | null;
  invite_code: string | null;
}

export interface WaitlistDecisionResult {
  approved: number;
  rejected: number;
  skipped: number;
  emails_failed: number;
}

export interface AdminBadge {
  feedback_new: number;
  waitlist_pending?: number;
}

/** Total shown on the Admin entry of the profile menu. */
export function adminBadgeTotal(badge: AdminBadge | undefined | null): number {
  return (badge?.feedback_new ?? 0) + (badge?.waitlist_pending ?? 0);
}

export const WAITLIST_MESSAGE_MAX = 280;

export type FeedbackKind = 'suggestion' | 'bug' | 'other';
export type FeedbackStatus = 'new' | 'seen' | 'done';

export interface FeedbackItem {
  id: string;
  user_id: string;
  username: string | null;
  display_name: string | null;
  kind: FeedbackKind;
  text: string;
  has_screenshot: boolean;
  page_url: string | null;
  build_id: string | null;
  user_agent: string | null;
  status: FeedbackStatus;
  admin_note: string | null;
  created_at: string;
  updated_at: string;
}

export interface SystemStatus {
  version: { app_version: string | null; git_sha: string | null };
  backup:
    | { configured: false }
    | { configured: true; ok: true; data: Record<string, unknown> }
    | { configured: true; ok: false; error: string };
  uploads: { available: boolean; bytes: number; files: number; computed_at: string };
  database: { bytes: number };
  worker: {
    reachable: boolean;
    alive: boolean;
    last_heartbeat?: string | null;
    heartbeat_ttl_ms?: number | null;
    queued?: number;
    error?: string;
  };
  spotify: { configured: boolean; connected_users: number; dev_mode_slots: number };
  pinterest: { configured: boolean };
}

export type AnnouncementLevel = 'info' | 'warning';

export interface Announcement {
  id: string;
  text: string;
  level: AnnouncementLevel;
  expires_at: string | null;
}

export interface AuditEntry {
  id: string;
  admin_id: string | null;
  admin_username: string | null;
  action: string;
  target_user_id: string | null;
  details: Record<string, unknown>;
  created_at: string;
}

// --- Formatting -------------------------------------------------------------------

export function formatBytes(bytes: number, locale = 'es'): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exp = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** exp;
  const digits = exp === 0 || value >= 100 ? 0 : 1;
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(value)} ${units[exp]}`;
}

/** Euros with enough precision for tiny AI bills (0,0042 €). */
export function formatEur(value: number, locale = 'es'): string {
  const digits = value !== 0 && Math.abs(value) < 0.1 ? 4 : 2;
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
    maximumFractionDigits: digits,
  }).format(value);
}

export function formatCompact(value: number, locale = 'es'): string {
  return new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(value);
}

/** Parse a decimal typed with either "," or "." ("0,15" -> 0.15). null = empty, NaN = invalid. */
export function parseDecimal(value: string): number | null {
  const trimmed = value.trim().replace(',', '.');
  if (!trimmed) return null;
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return Number.NaN;
  return Number(trimmed);
}

export function parseCap(value: string): number | null | 'invalid' {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!/^\d+$/.test(trimmed)) return 'invalid';
  return Number(trimmed);
}

/** What the admin must type to confirm an account deletion. */
export function deletionConfirmTarget(user: Pick<AdminUser, 'username' | 'email'>): string {
  return (user.username || user.email).toLowerCase();
}

export function deletionConfirmMatches(
  user: Pick<AdminUser, 'username' | 'email'>,
  typed: string
): boolean {
  return typed.trim().replace(/^@/, '').toLowerCase() === deletionConfirmTarget(user);
}

/** Relative share of the busiest day, for the CSS bar chart (0..1). */
export function barHeights(counts: number[]): number[] {
  const max = Math.max(0, ...counts);
  return counts.map((c) => (max === 0 ? 0 : c / max));
}

// --- Invites -------------------------------------------------------------------------

const INVITE_RE = /^[A-Za-z0-9_-]{4,32}$/;

/** Invite code from `?invite=` (null when absent or malformed). */
export function inviteFromSearch(value: string | null | undefined): string | null {
  const code = value?.trim();
  if (!code || !INVITE_RE.test(code)) return null;
  return code.toUpperCase();
}

// --- Announcement dismissal ------------------------------------------------------------

const DISMISSED_KEY = 'miaurmario.dismissedAnnouncement';

export function isAnnouncementDismissed(id: string): boolean {
  try {
    return window.localStorage.getItem(DISMISSED_KEY) === id;
  } catch {
    return false;
  }
}

export function dismissAnnouncement(id: string): void {
  try {
    window.localStorage.setItem(DISMISSED_KEY, id);
  } catch {
    /* storage blocked: the banner just comes back next time */
  }
}

/** ISO timestamp -> value for <input type="datetime-local"> in the browser's zone. */
export function toDateTimeLocal(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

/** Build id attached to feedback (set NEXT_PUBLIC_BUILD_ID at build time). */
export function appBuildId(): string | null {
  return process.env.NEXT_PUBLIC_BUILD_ID || process.env.NEXT_PUBLIC_GIT_SHA || null;
}
