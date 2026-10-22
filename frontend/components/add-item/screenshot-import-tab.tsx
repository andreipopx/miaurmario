'use client';

/* eslint-disable @next/next/no-img-element -- inlined data: photos the server re-encoded */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Check, ImagePlus, Loader2, Store } from 'lucide-react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { LazyStinky } from '@/components/native/lazy-stinky';
import { useClothingTypeLabel } from '@/lib/clothing-type-label';
import { useColorLabel } from '@/lib/tag-labels';
import { useCreateItem } from '@/lib/hooks/use-items';
import { dataUrlToFile, useScreenshotRead, type ScreenshotGarment } from '@/lib/hooks/use-intake';
import { formatPrice, garmentFormData } from '@/lib/intake/garment-form';
import { ApiError } from '@/lib/api';
import { getAiAccessErrorCode } from '@/lib/ai-access';
import { cn } from '@/lib/utils';

interface ScreenshotImportTabProps {
  /** Opened from a share or a paste with the screenshot already in hand. */
  initialFile?: File | null;
  onCancel: () => void;
  onDone: () => void;
}

interface Choice {
  garment: ScreenshotGarment;
  picked: boolean;
  /** Which of the garment's photos goes with it (0 = the shop's best, when found). */
  photo: number;
}

function errorCodeOf(error: unknown): string {
  // No AI on this account (or its quota is spent): reading a screenshot needs it.
  if (getAiAccessErrorCode(error)) return 'ai';
  if (error instanceof ApiError) {
    const detail = (error.data as { detail?: { code?: unknown } } | undefined)?.detail;
    if (detail && typeof detail.code === 'string') return detail.code;
  }
  return 'screenshot_failed';
}

/**
 * «Desde una captura»: the screenshot people already take of something they bought
 * (the shop's app, Instagram, Pinterest). Stinky lists the garments in it; for the
 * Inditex brands it finds each one in the shop's catalogue and brings the shop's
 * photos instead of a crop. The user ticks what to add and picks the photo.
 */
export function ScreenshotImportTab({ initialFile, onCancel, onDone }: ScreenshotImportTabProps) {
  const t = useTranslations('wardrobe.add.screenshot');
  const locale = useLocale();
  const typeLabel = useClothingTypeLabel();
  const colorLabel = useColorLabel();
  const read = useScreenshotRead();
  const createItem = useCreateItem();
  const inputRef = useRef<HTMLInputElement>(null);
  const [choices, setChoices] = useState<Choice[] | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [adding, setAdding] = useState<{ done: number; total: number } | null>(null);

  const analyse = useCallback(
    async (file: File) => {
      setChoices(null);
      setErrorCode(null);
      try {
        const result = await read.mutateAsync(file);
        setChoices(result.garments.map((garment) => ({ garment, picked: true, photo: 0 })));
      } catch (error) {
        setErrorCode(errorCodeOf(error));
      }
    },
    [read]
  );

  useEffect(() => {
    if (initialFile) void analyse(initialFile);
    // Only the file that opened the tab; later ones come through the picker.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialFile]);

  // On a computer the screenshot is usually on the clipboard: Ctrl+V works here.
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      if (read.isPending || adding) return;
      const file = Array.from(event.clipboardData?.files ?? []).find((f) => f.type.startsWith('image/'));
      if (!file) return;
      event.preventDefault();
      void analyse(file);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [analyse, read.isPending, adding]);

  const picked = choices?.filter((c) => c.picked) ?? [];

  const update = (index: number, patch: Partial<Choice>) =>
    setChoices((current) => current?.map((c, i) => (i === index ? { ...c, ...patch } : c)) ?? null);

  const addAll = async () => {
    if (!picked.length) return;
    setAdding({ done: 0, total: picked.length });
    let added = 0;
    let duplicates = 0;
    const failed: Choice[] = [];
    for (const choice of picked) {
      const g = choice.garment;
      try {
        const photo = g.images[choice.photo] ?? g.images[0];
        const file = await dataUrlToFile(photo.data_url, 'prenda');
        await createItem.mutateAsync(
          garmentFormData({
            file,
            type: g.type,
            subtype: g.subtype,
            primaryColor: g.primary_color,
            primaryColorHex: g.primary_color_hex,
            colors: g.colors,
            name: g.name,
            brand: g.brand,
            sourceUrl: g.source_url,
            price: g.price,
            createdVia: 'screenshot',
          })
        );
        added += 1;
      } catch (error) {
        if (error instanceof ApiError && error.status === 409) duplicates += 1;
        else failed.push(choice);
      }
      setAdding((a) => (a ? { ...a, done: a.done + 1 } : a));
    }
    setAdding(null);
    if (added) toast.success(t('added', { count: added }), { description: t('addedHint') });
    if (duplicates) toast.message(t('duplicates', { count: duplicates }));
    if (failed.length) {
      toast.error(t('someFailed', { count: failed.length }));
      setChoices(failed.map((c) => ({ ...c, picked: true })));
      return;
    }
    onDone();
  };

  const pickFile = (
    <input
      ref={inputRef}
      type="file"
      accept="image/*"
      className="hidden"
      data-testid="screenshot-input"
      onChange={(event) => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (file) void analyse(file);
      }}
    />
  );

  if (read.isPending) {
    return (
      <div className="flex flex-col items-center rounded-lg bg-signature-soft px-4 py-8 text-center" aria-live="polite">
        <LazyStinky state="thinking" size={104} label="" />
        <p className="mt-3 text-lg font-extrabold tracking-tight">{t('reading')}</p>
        <p className="mt-1 max-w-xs text-sm text-muted-foreground">{t('readingHint')}</p>
      </div>
    );
  }

  if (!choices) {
    return (
      <div className="space-y-4">
        {pickFile}
        <div className="flex flex-col items-center rounded-lg bg-panel p-5 text-center sm:p-7">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-signature text-signature-foreground">
            <ImagePlus className="h-6 w-6" strokeWidth={1.75} aria-hidden />
          </span>
          <p className="mt-3 text-[17px] font-extrabold tracking-tight">{t('title')}</p>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">{t('body')}</p>
          <Button className="mt-4" onClick={() => inputRef.current?.click()}>
            {t('choose')}
          </Button>
          <p className="mt-2 hidden text-xs text-muted-foreground sm:block">{t('pasteHint')}</p>
        </div>
        {errorCode && (
          <Alert variant="destructive">
            <AlertDescription>
              {t.has(`errors.${errorCode}`) ? t(`errors.${errorCode}`) : t('errors.screenshot_failed')}
            </AlertDescription>
          </Alert>
        )}
        <div className="flex justify-end">
          <Button type="button" variant="secondary" onClick={onCancel}>
            {t('cancel')}
          </Button>
        </div>
      </div>
    );
  }

  if (choices.length === 0) {
    return (
      <div className="space-y-4">
        {pickFile}
        <div className="flex flex-col items-center rounded-lg bg-panel px-4 py-7 text-center">
          <LazyStinky state="sad" size={96} label="" />
          <p className="mt-3 text-[17px] font-extrabold tracking-tight">{t('noneTitle')}</p>
          <p className="mt-1 max-w-xs text-sm text-muted-foreground">{t('noneBody')}</p>
          <Button className="mt-4" onClick={() => inputRef.current?.click()}>
            {t('another')}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {pickFile}
      <p className="text-sm font-semibold">{t('found', { count: choices.length })}</p>
      <ul className="space-y-3">
        {choices.map((choice, index) => {
          const g = choice.garment;
          const title = g.name || `${typeLabel(g.type)}${g.primary_color ? ` ${colorLabel(g.primary_color).toLowerCase()}` : ''}`;
          const photo = g.images[choice.photo] ?? g.images[0];
          return (
            <li
              key={index}
              className={cn(
                'rounded-lg bg-panel p-3 transition-opacity',
                !choice.picked && 'opacity-60'
              )}
            >
              <div className="flex gap-3">
                <span className="relative block h-28 w-24 shrink-0 overflow-hidden rounded-tile bg-background">
                  {photo && (
                    <img src={photo.data_url} alt="" className="absolute inset-0 h-full w-full object-contain p-1" />
                  )}
                </span>
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex items-start justify-between gap-2">
                    <p className="min-w-0 break-words text-[15px] font-bold leading-snug">{title}</p>
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={choice.picked}
                      aria-label={t('pick', { name: title })}
                      onClick={() => update(index, { picked: !choice.picked })}
                      className={cn(
                        'flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-[1.5px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                        choice.picked ? 'border-foreground bg-foreground text-background' : 'border-border bg-background'
                      )}
                    >
                      {choice.picked && <Check className="h-4 w-4" strokeWidth={3} aria-hidden />}
                    </button>
                  </div>
                  <p className="text-[13px] text-muted-foreground">
                    {[g.name ? typeLabel(g.type) : null, g.brand, formatPrice(g.price, g.currency, locale)]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                  {g.from_shop && (
                    <p className="inline-flex items-center gap-1 rounded-full bg-background px-2 py-0.5 text-[12px] font-semibold">
                      <Store className="h-3.5 w-3.5" aria-hidden />
                      {t('fromShop', { brand: g.brand ?? '' })}
                    </p>
                  )}
                </div>
              </div>
              {g.images.length > 1 && (
                <div className="mt-3">
                  <p className="mb-1.5 text-[12px] font-semibold text-muted-foreground">{t('whichPhoto')}</p>
                  <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 pt-1">
                    {g.images.map((image, i) => {
                      const isCrop = i === g.images.length - 1;
                      return (
                        <button
                          key={i}
                          type="button"
                          aria-pressed={choice.photo === i}
                          aria-label={isCrop ? t('cropPhoto') : t('shopPhoto', { n: i + 1 })}
                          onClick={() => update(index, { photo: i })}
                          className={cn(
                            'relative h-16 w-14 shrink-0 overflow-hidden rounded-quick bg-background ring-offset-2 ring-offset-panel focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                            choice.photo === i && 'ring-2 ring-foreground'
                          )}
                        >
                          <img src={image.data_url} alt="" className="absolute inset-0 h-full w-full object-contain" />
                          {isCrop && (
                            <span className="absolute inset-x-0 bottom-0 bg-foreground/75 text-center text-[9px] font-bold text-background">
                              {t('cropTag')}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-muted-foreground">{t('privacy')}</p>
      <div className="flex flex-wrap justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" onClick={() => inputRef.current?.click()} disabled={!!adding}>
          {t('another')}
        </Button>
        <Button type="button" onClick={addAll} disabled={!picked.length || !!adding}>
          {adding ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              {t('adding', { done: adding.done, total: adding.total })}
            </>
          ) : (
            t('add', { count: picked.length })
          )}
        </Button>
      </div>
    </div>
  );
}
