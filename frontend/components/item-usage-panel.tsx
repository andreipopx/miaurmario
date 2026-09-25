'use client';

/**
 * «Cuánto la usas»: the per-garment usage panel in the item detail.
 *
 * Four things, in the order the owner asks them: how many times he has worn it,
 * when he last did, what each wear has cost him, and what it goes out with. Then
 * two things he can do about it: tell the stylist what to do with this garment,
 * and ask for a look built around it.
 *
 * The tone is fixed: it reports and it offers. It never scolds and it never
 * suggests buying anything.
 */

import { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { Calendar, Coins, Loader2, Shirt, Sparkles, Wand2 } from 'lucide-react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useItemUsage, useUpdateItem } from '@/lib/hooks/use-items';
import { useRescueItem, type RescueResponse } from '@/lib/hooks/use-outfits';
import { useColorLabel, useTagLabel } from '@/lib/tag-labels';
import { cn } from '@/lib/utils';
import type { Item, UsagePreference } from '@/lib/types';

const PREFERENCES: UsagePreference[] = ['more', 'normal', 'rest'];

/** Euros, like the rest of the app. The garment's price has no currency of its own. */
function formatMoney(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string | null;
}) {
  return (
    <div className="rounded-[14px] bg-background p-2.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm font-bold">{value}</p>
      {hint && <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function ItemUsagePanel({ item }: { item: Item }) {
  const t = useTranslations('wardrobe.item.usage');
  const locale = useLocale();
  const tagLabel = useTagLabel();
  const colorLabel = useColorLabel();

  const { data: usage } = useItemUsage(item.id);
  const updateItem = useUpdateItem();
  const rescue = useRescueItem();
  const [result, setResult] = useState<RescueResponse | null>(null);

  // The item row is the source of truth for the setting; the usage payload only
  // mirrors it, and may be a request behind.
  const preference: UsagePreference = item.usage_preference ?? 'normal';
  const wearCount = usage?.wear_count ?? item.wear_count ?? 0;
  const price = usage?.purchase_price != null ? Number(usage.purchase_price) : null;
  const costPerWear = usage?.cost_per_wear != null ? Number(usage.cost_per_wear) : null;

  const lastWorn = (() => {
    const days = usage?.days_since_last_worn;
    if (days == null) return t('never');
    if (days === 0) return t('today');
    return t('daysAgo', { days });
  })();

  const costValue = (() => {
    if (costPerWear != null) return formatMoney(costPerWear, locale);
    if (price == null) return t('noPrice');
    return t('notWornYet');
  })();
  const costHint = costPerWear == null && price == null ? t('noPriceHelp') : null;

  async function setPreference(next: UsagePreference) {
    if (next === preference) return;
    try {
      await updateItem.mutateAsync({ id: item.id, data: { usage_preference: next } });
      toast.success(t('prefSaved'));
    } catch {
      toast.error(t('prefFailed'));
    }
  }

  async function onRescue() {
    setResult(null);
    try {
      setResult(await rescue.mutateAsync({ itemId: item.id }));
    } catch {
      toast.error(t('rescueFailed'));
    }
  }

  function hintText(code: string, value: string | null): string {
    switch (code) {
      case 'missing_role':
        return t('hints.missing_role', {
          role: value ? t(`hintRoles.${value}` as never, {}) : '',
        });
      case 'only_color':
        return t('hints.only_color', { color: colorLabel(value ?? '').toLowerCase() });
      case 'formality_gap':
        return t('hints.formality_gap', { formality: tagLabel('formality', value).toLowerCase() });
      case 'too_few_items':
        return t('hints.too_few_items');
      case 'all_need_wash':
        return t('hints.all_need_wash');
      default:
        return t('hints.unknown');
    }
  }

  return (
    <div className="space-y-3 rounded-lg bg-panel p-4">
      <div className="flex items-center gap-2 text-[15px] font-bold">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-pop-mint text-pop-foreground">
          <Coins className="h-3.5 w-3.5" strokeWidth={1.75} />
        </span>
        {t('sectionTitle')}
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <Stat label={t('timesWornLabel')} value={t('timesWorn', { count: wearCount })} />
        <Stat label={t('lastWornLabel')} value={lastWorn} />
        <Stat label={t('costPerWearLabel')} value={costValue} hint={costHint} />
      </div>

      {/* Con qué suele combinarse */}
      <div className="space-y-1.5">
        <p className="text-xs font-semibold text-muted-foreground">{t('goesWithTitle')}</p>
        {!usage || usage.co_worn.length === 0 ? (
          <p className="text-xs leading-snug text-muted-foreground">{t('goesWithEmpty')}</p>
        ) : (
          <>
            <ul className="space-y-1">
              {usage.co_worn.map((partner) => (
                <li key={partner.id} className="flex items-center gap-2">
                  <span className="relative h-8 w-8 shrink-0 overflow-hidden rounded-[10px] bg-background">
                    {partner.thumbnail_url ? (
                      <Image
                        src={partner.thumbnail_url}
                        alt={partner.name || tagLabel('types', partner.type)}
                        fill
                        className="object-contain p-0.5"
                        sizes="32px"
                      />
                    ) : (
                      <span className="flex h-full w-full items-center justify-center">
                        <Shirt className="h-4 w-4 text-muted-foreground" strokeWidth={1.75} />
                      </span>
                    )}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-xs font-semibold">
                    {partner.name || tagLabel('types', partner.type)}
                  </span>
                  <Badge variant="outline" className="shrink-0 text-[11px]">
                    {t('goesWithTimes', { count: partner.times })}
                  </Badge>
                </li>
              ))}
            </ul>
            <p className="text-[11px] text-muted-foreground">
              {t('goesWithBasis', { count: usage.co_worn_looks })}
            </p>
          </>
        )}
      </div>

      {/* Sácala más / normal / déjala tranquila */}
      <div className="space-y-1.5">
        <p className="text-xs font-semibold text-muted-foreground">{t('prefTitle')}</p>
        <div role="radiogroup" aria-label={t('prefTitle')} className="flex flex-wrap gap-1.5">
          {PREFERENCES.map((option) => {
            const active = option === preference;
            const label =
              option === 'more' ? t('prefMore') : option === 'rest' ? t('prefRest') : t('prefNormal');
            return (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={active}
                disabled={updateItem.isPending}
                onClick={() => setPreference(option)}
                className={cn(
                  'min-h-[36px] rounded-full px-3 text-[13px] font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50',
                  active
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-background text-foreground hover:bg-accent'
                )}
              >
                {label}
              </button>
            );
          })}
        </div>
        <p className="text-[11px] leading-snug text-muted-foreground">
          {preference === 'more'
            ? t('prefMoreHelp')
            : preference === 'rest'
              ? t('prefRestHelp')
              : t('prefNormalHelp')}{' '}
          {t('prefHelp')}
        </p>
      </div>

      {/* Rescátala */}
      <div className="space-y-2">
        <Button
          variant="signature"
          size="sm"
          className="w-full"
          onClick={onRescue}
          disabled={rescue.isPending}
        >
          {rescue.isPending ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {t('rescueBusy')}
            </>
          ) : (
            <>
              <Wand2 className="h-3.5 w-3.5" strokeWidth={1.75} />
              {t('rescue')}
            </>
          )}
        </Button>
        {!result && (
          <p className="text-[11px] leading-snug text-muted-foreground">{t('rescueHelp')}</p>
        )}

        {result && result.rescued && result.outfit && (
          <div className="space-y-2 rounded-[14px] bg-background p-3">
            <p className="flex flex-wrap items-center gap-1.5 text-xs font-bold">
              <Sparkles className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
              {t('rescueTitle')}
              <Badge variant="outline" className="text-[11px] font-semibold">
                {result.engine === 'ai' ? t('rescueByAi') : t('rescueByHeuristic')}
              </Badge>
            </p>
            <div className="flex flex-wrap gap-1.5">
              {result.outfit.items.map((piece) => (
                <span
                  key={piece.id}
                  title={piece.name || tagLabel('types', piece.type)}
                  className={cn(
                    'relative h-12 w-12 overflow-hidden rounded-[12px] bg-panel',
                    piece.id === item.id && 'ring-2 ring-signature'
                  )}
                >
                  {piece.thumbnail_url ? (
                    <Image
                      src={piece.thumbnail_url}
                      alt={piece.name || tagLabel('types', piece.type)}
                      fill
                      className="object-contain p-1"
                      sizes="48px"
                    />
                  ) : (
                    <span className="flex h-full w-full items-center justify-center">
                      <Shirt className="h-5 w-5 text-muted-foreground" strokeWidth={1.75} />
                    </span>
                  )}
                </span>
              ))}
            </div>
            <Button variant="outline" size="sm" className="w-full" asChild>
              <Link href={`/dashboard/outfits/${result.outfit.id}`}>
                <Calendar className="h-3.5 w-3.5" strokeWidth={1.75} />
                {t('rescueOpen')}
              </Link>
            </Button>
          </div>
        )}

        {result && !result.rescued && (
          <div className="space-y-1.5 rounded-[14px] bg-background p-3">
            <p className="text-xs font-bold">
              {result.reason === 'item_unavailable'
                ? t('unavailableTitle')
                : t('noCombinationTitle')}
            </p>
            {result.hints.length > 0 && (
              <ul className="space-y-1">
                {result.hints.map((hint) => (
                  <li
                    key={`${hint.code}:${hint.value ?? ''}`}
                    className="flex items-start gap-1.5 text-xs leading-snug text-muted-foreground"
                  >
                    <span
                      aria-hidden
                      className="mt-[6px] h-1 w-1 shrink-0 rounded-full bg-muted-foreground"
                    />
                    <span>{hintText(hint.code, hint.value)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
