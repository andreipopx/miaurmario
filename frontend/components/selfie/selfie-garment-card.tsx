'use client';

import Image from 'next/image';
import { useTranslations } from 'next-intl';
import { Check, Loader2, Plus, Search } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useTagLabel } from '@/lib/tag-labels';
import { cn } from '@/lib/utils';
import type { SelfieGarment, SelfieItemSummary } from '@/lib/selfie';

interface SelfieGarmentCardProps {
  garment: SelfieGarment;
  /** The wardrobe item this garment currently points at. */
  picked: SelfieItemSummary | null;
  options: SelfieItemSummary[];
  onPick: (itemId: string | null) => void;
  onBrowse: () => void;
  onAdd: () => void;
  isAdding?: boolean;
  wasAdded?: boolean;
}

/**
 * One garment read off the photo. Describes clothes only — colour, pattern and
 * type — never the person wearing them, and says in plain words which wardrobe
 * item it is without showing any score.
 */
export function SelfieGarmentCard({
  garment,
  picked,
  options,
  onPick,
  onBrowse,
  onAdd,
  isAdding = false,
  wasAdded = false,
}: SelfieGarmentCardProps) {
  const t = useTranslations('selfie');
  const label = useTagLabel();

  const typeLabel = label('types', garment.type);
  const details = [
    garment.primary_color ? label('colors', garment.primary_color) : null,
    garment.pattern && garment.pattern !== 'solid' ? label('patterns', garment.pattern) : null,
    garment.material ? label('materials', garment.material) : null,
  ].filter(Boolean) as string[];

  const pickedName = picked ? (picked.name ?? label('types', picked.type)) : null;

  return (
    <li className="rounded-lg bg-panel p-3 sm:p-4">
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="mt-0.5 h-10 w-10 shrink-0 overflow-hidden rounded-full border border-border bg-background"
        >
          {picked?.thumbnail_url || picked?.image_url ? (
            <Image
              src={(picked.thumbnail_url || picked.image_url)!}
              alt=""
              width={40}
              height={40}
              className="h-full w-full object-contain p-0.5"
            />
          ) : null}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-bold leading-snug">{typeLabel}</p>
          {details.length > 0 && (
            <p className="text-sm leading-snug text-muted-foreground">{details.join(' · ')}</p>
          )}
          <p className={cn('mt-1 text-sm leading-snug', picked ? 'font-semibold' : 'text-muted-foreground')}>
            {picked ? t('isYours', { name: pickedName ?? '' }) : t('notInWardrobe')}
          </p>
        </div>
      </div>

      {options.length > 0 && (
        <>
          <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t('otherOptions')}
          </p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {options.map((option) => {
              const isPicked = picked?.id === option.id;
              const name = option.name ?? label('types', option.type);
              return (
                <li key={option.id}>
                  <button
                    type="button"
                    aria-pressed={isPicked}
                    onClick={() => onPick(option.id)}
                    className={cn(
                      'inline-flex max-w-full items-center gap-2 rounded-full border-[1.5px] py-1.5 pl-1.5 pr-3 text-sm transition-[background-color,color,transform] duration-150 active:scale-[0.97]',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                      isPicked
                        ? 'border-transparent bg-primary font-semibold text-primary-foreground'
                        : 'border-border bg-background font-medium hover:bg-accent'
                    )}
                  >
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full bg-panel">
                      {option.thumbnail_url || option.image_url ? (
                        <Image
                          src={(option.thumbnail_url || option.image_url)!}
                          alt=""
                          width={28}
                          height={28}
                          className="h-full w-full object-contain"
                        />
                      ) : null}
                    </span>
                    <span className="truncate">{name}</span>
                    {isPicked && <Check className="h-4 w-4 shrink-0" strokeWidth={2.5} aria-hidden />}
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="outline" onClick={onBrowse}>
          <Search className="h-4 w-4" strokeWidth={1.75} aria-hidden />
          {t('chooseOther')}
        </Button>
        {picked && (
          <Button type="button" size="sm" variant="ghost" onClick={() => onPick(null)}>
            {t('clearPick')}
          </Button>
        )}
        {!picked && !wasAdded && (
          <Button type="button" size="sm" variant="signature" onClick={onAdd} disabled={isAdding}>
            {isAdding ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <Plus className="h-4 w-4" strokeWidth={2} aria-hidden />
            )}
            {isAdding ? t('adding') : t('addToWardrobe')}
          </Button>
        )}
        {wasAdded && !picked && (
          <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-success">
            <Check className="h-4 w-4" strokeWidth={2.5} aria-hidden />
            {t('added')}
          </span>
        )}
      </div>
      {!picked && !wasAdded && (
        <p className="mt-2 text-xs leading-snug text-muted-foreground">{t('addPhotoLater')}</p>
      )}
    </li>
  );
}
