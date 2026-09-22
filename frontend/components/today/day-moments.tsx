'use client';

import { useId, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { ArrowRightLeft, Check, Loader2, MessageCircle, Music, Plus, RefreshCw, Shirt, Sparkles, X } from 'lucide-react';
import { TransitionLink } from '@/components/native/transition-link';
import { cn } from '@/lib/utils';
import { getErrorMessage } from '@/lib/api';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Chip, popColorAt } from '@/components/chip';
import { StinkyTip } from '@/components/stinky-tip';
import { StinkyAvatar } from '@/components/brand/stinky-avatar';
import { LazyStinky } from '@/components/native/lazy-stinky';
import { ShareLookPrompt } from '@/components/social/share-look-prompt';
import { useAIStatus } from '@/lib/hooks/use-ai-access';
import { useDayPlan, useDeleteMoment, useSuggestMoment, useWearMomentLook } from '@/lib/hooks/use-day-moments';
import {
  MOMENT_OCCASIONS,
  MOMENT_PRESETS,
  nextPreset,
  shortTime,
  transitionSource,
  transitionSummary,
  type DayMoment,
  type MomentPresetKey,
} from '@/lib/day-moments';

function useOccasionLabel() {
  const tOcc = useTranslations('suggest.occasions');
  return (occasion: string) => (tOcc.has(occasion as never) ? tOcc(occasion as never) : occasion);
}

// -- One moment ----------------------------------------------------------------------

function MomentCard({
  moment,
  single,
  removable,
  previousLabel,
  onWorn,
}: {
  moment: DayMoment;
  single: boolean;
  removable: boolean;
  previousLabel: string | null;
  onWorn: (outfitId: string, shared: boolean) => void;
}) {
  const t = useTranslations('dashboard.moments');
  const tToday = useTranslations('dashboard.today');
  const occasionLabel = useOccasionLabel();
  const suggest = useSuggestMoment();
  const wear = useWearMomentLook();
  const remove = useDeleteMoment();
  const titleId = useId();

  const outfit = moment.outfit;
  const title = moment.label ?? (single ? tToday('lookTitle') : t('defaultLabel'));
  const time = shortTime(moment.time);
  const isTransition = moment.transition_from_order !== null;
  const summary = isTransition ? transitionSummary(moment) : null;
  const shared = new Set(moment.shared_item_ids);
  const items = outfit?.items.slice(0, 4) ?? [];
  const extra = (outfit?.items.length ?? 0) - items.length;
  const music = outfit?.music_inspiration;
  const musicLabel = music ? music.track || music.artist || music.label : null;
  const tip =
    outfit?.style_notes ||
    outfit?.reasoning ||
    (isTransition ? t('transitionTip') : tToday('defaultTip'));

  const anotherIdea = () =>
    suggest.mutate(
      { order: moment.order, transition: isTransition },
      { onError: (err) => toast.error(getErrorMessage(err, t('suggestError'))) }
    );

  const wearIt = () => {
    if (!outfit) return;
    wear.mutate(outfit.id, {
      onSuccess: () => {
        toast.success(t('wornToast'));
        onWorn(outfit.id, !!outfit.visibility && outfit.visibility !== 'private');
      },
      onError: (err) => toast.error(getErrorMessage(err, t('wearError'))),
    });
  };

  const removeIt = () =>
    remove.mutate(moment.order, {
      onSuccess: () => toast.success(t('removedToast')),
      onError: (err) => toast.error(getErrorMessage(err, t('removeError'))),
    });

  return (
    <article aria-labelledby={titleId} className="rounded-lg bg-panel p-3.5 sm:p-5">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 id={titleId} className="truncate text-[15px] font-bold first-letter:uppercase sm:text-lg">
            {title}
          </h3>
          {(time || !single) && (
            <p className="mt-0.5 text-[13px] font-medium text-muted-foreground">
              {[time, occasionLabel(moment.occasion)].filter(Boolean).join(' · ')}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {musicLabel && (
            <Link
              href="/dashboard/music"
              aria-label={`${musicLabel} · ${tToday('openMusic')}`}
              className="inline-flex h-[26px] max-w-[9rem] items-center gap-1.5 rounded-full bg-background px-2.5 text-xs font-semibold transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Music className="h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden />
              <span className="truncate">{musicLabel}</span>
            </Link>
          )}
          {removable && !moment.is_worn && (
            <button
              type="button"
              onClick={removeIt}
              disabled={remove.isPending}
              aria-label={t('remove', { name: title })}
              className="-mr-1.5 inline-flex h-11 w-11 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
            >
              {remove.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <X className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden />
              )}
            </button>
          )}
        </div>
      </header>

      {summary && (
        <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-background px-3 py-1 text-xs font-semibold">
          <ArrowRightLeft className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
          {previousLabel
            ? t('transitionFrom', { from: previousLabel, kept: summary.kept, changed: summary.changed })
            : t('transitionBadge', { kept: summary.kept, changed: summary.changed })}
        </p>
      )}

      {outfit ? (
        <>
          <TransitionLink
            href={`/dashboard/outfits/${outfit.id}`}
            aria-label={t('viewLook', { name: title })}
            className={cn(
              'pressable mt-2 grid gap-2 rounded-tile focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              single ? 'h-[208px] sm:h-[280px]' : 'h-[168px] sm:h-[220px]',
              items.length > 1 ? 'grid-cols-2' : 'grid-cols-1',
              items.length > 2 ? 'grid-rows-2' : 'grid-rows-1'
            )}
          >
            {items.map((item, i) => (
              <div key={item.id} className="relative min-h-0">
                {item.thumbnail_url ? (
                  <Image
                    src={item.thumbnail_url}
                    alt={item.name || item.type}
                    fill
                    className="object-contain p-1 mix-blend-multiply dark:mix-blend-normal"
                    sizes="(max-width: 1024px) 45vw, 25vw"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center rounded-tile bg-background/60">
                    <Shirt className="h-10 w-10 text-muted-foreground" strokeWidth={1.5} aria-hidden />
                  </div>
                )}
                {isTransition && !shared.has(item.id) && (
                  <span className="absolute left-1 top-1 rounded-full bg-signature px-2 py-0.5 text-[11px] font-bold text-signature-foreground">
                    {t('newPiece')}
                  </span>
                )}
                {i === items.length - 1 && extra > 0 && (
                  <span className="absolute bottom-1 right-1 rounded-full bg-background px-2 py-0.5 text-[11px] font-bold">
                    +{extra}
                  </span>
                )}
              </div>
            ))}
          </TransitionLink>
          <StinkyTip className="mt-3" clamp>
            {tip}
          </StinkyTip>
        </>
      ) : (
        <p className="mt-3 rounded-tile bg-background/60 px-4 py-6 text-center text-sm font-medium text-muted-foreground">
          {t('noLookYet')}
        </p>
      )}

      <div className="mt-3 flex gap-2.5">
        {moment.is_worn ? (
          <p className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-full bg-background text-sm font-bold">
            <Check className="h-[18px] w-[18px]" strokeWidth={2.25} aria-hidden />
            {t('worn')}
          </p>
        ) : (
          <>
            <Button
              variant="secondary"
              size="lg"
              className="flex-1 bg-background"
              onClick={anotherIdea}
              disabled={suggest.isPending}
            >
              {suggest.isPending ? (
                <Loader2 className="h-[18px] w-[18px] animate-spin" aria-hidden />
              ) : outfit ? (
                <RefreshCw className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden />
              ) : (
                <Sparkles className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden />
              )}
              {outfit ? tToday('anotherIdea') : t('suggest')}
            </Button>
            {outfit && (
              <Button size="lg" className="flex-1" onClick={wearIt} disabled={wear.isPending}>
                {wear.isPending ? (
                  <Loader2 className="h-[18px] w-[18px] animate-spin" aria-hidden />
                ) : (
                  <Check className="h-[18px] w-[18px]" strokeWidth={2.25} aria-hidden />
                )}
                {tToday('wearIt')}
              </Button>
            )}
          </>
        )}
      </div>
    </article>
  );
}

// -- Add a moment ------------------------------------------------------------------------

function AddMomentForm({ moments, onDone }: { moments: DayMoment[]; onDone: () => void }) {
  const t = useTranslations('dashboard.moments');
  const occasionLabel = useOccasionLabel();
  const suggest = useSuggestMoment();
  const { data: aiStatus } = useAIStatus();
  const noAi = Boolean(aiStatus && !aiStatus.capabilities.text);

  const initial = nextPreset(moments);
  const [preset, setPreset] = useState<MomentPresetKey | 'custom'>(initial.key);
  const [customLabel, setCustomLabel] = useState('');
  const [time, setTime] = useState(initial.time);
  const [occasion, setOccasion] = useState(initial.occasion);
  const source = transitionSource(moments);
  const [transition, setTransition] = useState(Boolean(source));
  const ids = { label: useId(), time: useId(), transition: useId(), title: useId() };

  const pickPreset = (key: MomentPresetKey) => {
    const p = MOMENT_PRESETS.find((x) => x.key === key)!;
    setPreset(key);
    setTime(p.time);
    setOccasion(p.occasion);
  };

  const label = preset === 'custom' ? customLabel.trim() : t(`presets.${preset}`);
  const canSubmit = label.length > 0 && !suggest.isPending;
  const sourceLabel = source ? source.label ?? t('defaultLabel') : null;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    suggest.mutate(
      { label, time: time || null, occasion, transition: Boolean(source) && transition },
      {
        onSuccess: (res) => {
          if (res.engine === 'heuristic') toast.message(t('heuristicToast'));
          onDone();
        },
        onError: (err) => toast.error(getErrorMessage(err, t('suggestError'))),
      }
    );
  };

  return (
    <form onSubmit={submit} aria-labelledby={ids.title} className="space-y-4 rounded-lg border-[1.5px] border-border p-3.5 sm:p-5">
      <div className="flex items-center justify-between gap-3">
        <h3 id={ids.title} className="text-[15px] font-bold">
          {t('addTitle')}
        </h3>
        <button
          type="button"
          onClick={onDone}
          aria-label={t('cancel')}
          className="-mr-1.5 inline-flex h-11 w-11 items-center justify-center rounded-full hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden />
        </button>
      </div>

      <div role="group" aria-label={t('whenLabel')} className="-mx-3.5 flex gap-2 overflow-x-auto px-3.5 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:px-0">
        {MOMENT_PRESETS.map((p) => (
          <Chip key={p.key} active={preset === p.key} onClick={() => pickPreset(p.key)}>
            {t(`presets.${p.key}`)}
          </Chip>
        ))}
        <Chip active={preset === 'custom'} onClick={() => setPreset('custom')}>
          {t('presets.custom')}
        </Chip>
      </div>

      {preset === 'custom' && (
        <div className="space-y-1.5">
          <label htmlFor={ids.label} className="px-1 text-sm font-semibold">
            {t('customLabel')}
          </label>
          <Input
            id={ids.label}
            value={customLabel}
            onChange={(e) => setCustomLabel(e.target.value)}
            maxLength={40}
            placeholder={t('customPlaceholder')}
            autoFocus
          />
        </div>
      )}

      <div role="group" aria-label={t('occasionLabel')} className="-mx-3.5 flex gap-2 overflow-x-auto px-3.5 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:px-0">
        {MOMENT_OCCASIONS.map((occ, i) => (
          <Chip key={occ} active={occasion === occ} dot={popColorAt(i)} activeStyle="pop" onClick={() => setOccasion(occ)}>
            {occasionLabel(occ)}
          </Chip>
        ))}
      </div>

      <div className="flex items-center justify-between gap-3">
        <label htmlFor={ids.time} className="px-1 text-sm font-semibold">
          {t('timeLabel')}
        </label>
        <Input
          id={ids.time}
          type="time"
          value={time}
          onChange={(e) => setTime(e.target.value)}
          className="h-11 w-32 px-4"
        />
      </div>

      {source && (
        <div className="flex items-start justify-between gap-3 rounded-2xl bg-panel p-3">
          <label htmlFor={ids.transition} className="min-w-0">
            <span className="block text-sm font-bold">{t('transitionToggle', { from: sourceLabel ?? '' })}</span>
            <span className="mt-0.5 block text-[13px] text-muted-foreground">{t('transitionHint')}</span>
          </label>
          <Switch id={ids.transition} checked={transition} onCheckedChange={setTransition} className="mt-0.5" />
        </div>
      )}

      {noAi && <p className="px-1 text-[13px] text-muted-foreground">{t('noAiNote')}</p>}

      <Button type="submit" size="lg" className="w-full" disabled={!canSubmit}>
        {suggest.isPending ? (
          <Loader2 className="h-[18px] w-[18px] animate-spin" aria-hidden />
        ) : (
          <Sparkles className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden />
        )}
        {t('submit')}
      </Button>
    </form>
  );
}

// -- The day ---------------------------------------------------------------------------

/** "Hoy": the day's moments (work in the morning, a date at night...), one look each. */
export function DayMoments() {
  const t = useTranslations('dashboard.moments');
  const tToday = useTranslations('dashboard.today');
  const { data: plan, isLoading, isError, refetch } = useDayPlan();
  const [adding, setAdding] = useState(false);
  // After "Me lo pongo", offer to share that look with friends.
  const [justWorn, setJustWorn] = useState<{ id: string; shared: boolean } | null>(null);

  const moments = plan?.moments ?? [];
  const single = moments.length === 1;
  const canAdd = moments.length < (plan?.max_moments ?? 6);
  const labelOf = (order: number | null) => {
    const m = moments.find((x) => x.order === order);
    return m ? m.label ?? t('defaultLabel') : null;
  };

  return (
    <section aria-labelledby="today-look-title" className="space-y-3">
      {justWorn && (
        <ShareLookPrompt
          key={justWorn.id}
          outfitId={justWorn.id}
          alreadyShared={justWorn.shared}
          onDismiss={() => setJustWorn(null)}
        />
      )}

      <div className="flex items-center justify-between gap-3 px-1">
        <h2 id="today-look-title" className="text-[15px] font-bold sm:text-lg">
          {moments.length > 1 ? t('title') : tToday('lookTitle')}
        </h2>
        {moments.length > 1 && (
          <span className="text-sm font-semibold text-muted-foreground">{t('count', { count: moments.length })}</span>
        )}
      </div>

      {isLoading ? (
        <Skeleton className="h-[300px] w-full rounded-lg" />
      ) : isError ? (
        <div className="flex items-center justify-between gap-4 rounded-lg bg-panel p-4">
          <p className="text-sm font-medium text-muted-foreground">{t('loadError')}</p>
          <Button variant="secondary" size="sm" className="bg-background" onClick={() => refetch()}>
            {t('retry')}
          </Button>
        </div>
      ) : moments.length === 0 ? (
        !adding && (
          <div className="rounded-lg bg-panel p-3.5 sm:p-5">
            <div className="flex flex-col items-center px-4 pb-2 pt-4 text-center">
              <div className="flex h-32 w-32 items-center justify-center rounded-full bg-signature-soft">
                <LazyStinky state="idle" size={112} label="" />
              </div>
              <p className="mt-4 text-lg font-extrabold tracking-tight">{tToday('noLookTitle')}</p>
              <p className="mt-1 max-w-xs text-sm text-muted-foreground">{tToday('noLookBody')}</p>
            </div>
            <div className="mt-3 flex gap-2.5">
              <Button asChild variant="secondary" size="lg" className="flex-1 bg-background">
                <Link href="/dashboard/suggest">
                  <Sparkles className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden />
                  {tToday('askStinky')}
                </Link>
              </Button>
              <Button size="lg" className="flex-1" onClick={() => setAdding(true)}>
                <Plus className="h-[18px] w-[18px]" strokeWidth={2.25} aria-hidden />
                {t('planDay')}
              </Button>
            </div>
          </div>
        )
      ) : (
        <ol className="space-y-3">
          {moments.map((m, i) => (
            <li key={m.order}>
              <MomentCard
                moment={m}
                single={single}
                removable={!single || m.label !== null}
                previousLabel={labelOf(m.transition_from_order) ?? (i > 0 ? labelOf(moments[i - 1].order) : null)}
                onWorn={(id, shared) => setJustWorn({ id, shared })}
              />
            </li>
          ))}
        </ol>
      )}

      {adding ? (
        <AddMomentForm moments={moments} onDone={() => setAdding(false)} />
      ) : (
        moments.length > 0 &&
        canAdd && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="flex min-h-[52px] w-full items-center justify-center gap-2 rounded-lg border-[1.5px] border-dashed border-border text-[15px] font-bold transition active:scale-[0.99] hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Plus className="h-[18px] w-[18px]" strokeWidth={2.25} aria-hidden />
            {t('add')}
          </button>
        )
      )}

      <Link
        href="/dashboard/stinky"
        className="flex min-h-[64px] items-center gap-3 rounded-lg bg-signature-soft p-2.5 pr-4 transition active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <StinkyAvatar size={44} className="bg-background" />
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-bold leading-tight">{tToday('chatWithStinky')}</span>
          <span className="block truncate text-[13px] text-muted-foreground">{tToday('chatWithStinkyBody')}</span>
        </span>
        <MessageCircle className="h-5 w-5 shrink-0" strokeWidth={1.75} aria-hidden />
      </Link>
    </section>
  );
}
