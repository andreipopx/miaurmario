'use client';

import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { ImagePlus, Link2, Loader2, Ruler } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useSizeSummary } from '@/components/style-quiz/size-fields';
import { useHabitualSizes } from '@/lib/hooks/use-habitual-sizes';
import { hasSizes } from '@/lib/style-quiz/cards';
import { LinkPreview, dataUrlToFile, useLinkPreview } from '@/lib/hooks/use-intake';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';
import { formatPrice } from '@/lib/intake/garment-form';

export interface LinkPrefill {
  file: File | null;
  name: string;
  brand: string;
  primaryColor: string;
  /** The shop's own shade of that colour, when it publishes one. */
  primaryColorHex: string | null;
  /** The garment type the shop's category gives away. */
  type: string | null;
  price: string | number | null;
  sourceUrl: string;
}

interface LinkImportTabProps {
  initialUrl?: string | null;
  onUse: (prefill: LinkPrefill) => void;
  onCancel: () => void;
  /** Shops that will not be read from a server: a screenshot always works. */
  onScreenshot?: () => void;
}

/** The backend answers refusals as `{ detail: { code, message } }`. */
function errorCodeOf(error: unknown): string {
  if (error instanceof ApiError) {
    const detail = (error.data as { detail?: { code?: unknown } } | undefined)?.detail;
    if (detail && typeof detail.code === 'string') return detail.code;
  }
  return 'fetch_failed';
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/**
 * Paste a shop link. The page is fetched and read on the server (no JavaScript
 * from the shop ever runs, here or there); whatever comes back only ever
 * pre-fills the normal add form, which the user still reviews and saves.
 */
export function LinkImportTab({ initialUrl, onUse, onCancel, onScreenshot }: LinkImportTabProps) {
  const t = useTranslations('wardrobe.add.link');
  const locale = useLocale();
  const tSizes = useTranslations('firstRun.styleQuiz.sizes');
  const habitualSizes = useHabitualSizes();
  const sizeSummary = useSizeSummary();
  const [url, setUrl] = useState(initialUrl ?? '');
  const [preview, setPreview] = useState<LinkPreview | null>(null);
  /** Which of the shop's photos goes with the garment (0 = the garment alone, when known). */
  const [photo, setPhoto] = useState(0);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const linkPreview = useLinkPreview();
  const images = preview?.images?.length ? preview.images : preview?.image ? [preview.image] : [];

  useEffect(() => {
    if (initialUrl) setUrl(initialUrl);
  }, [initialUrl]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const candidate = url.trim();
    if (!candidate) return;
    setPreview(null);
    setErrorCode(null);
    setPhoto(0);
    try {
      const result = await linkPreview.mutateAsync(candidate);
      setPreview(result);
    } catch (error) {
      setErrorCode(errorCodeOf(error));
    }
  };

  const use = async () => {
    if (!preview) return;
    let file: File | null = null;
    const chosen = images[photo] ?? preview.image;
    if (chosen) {
      try {
        file = await dataUrlToFile(chosen.data_url, 'prenda');
      } catch {
        file = null;
      }
    }
    onUse({
      file,
      name: preview.name ?? '',
      brand: preview.brand ?? '',
      primaryColor: preview.primary_color ?? '',
      primaryColorHex: preview.primary_color_hex ?? null,
      type: preview.type ?? null,
      price: preview.price ?? null,
      sourceUrl: preview.source_url,
    });
  };

  const shown = images[photo] ?? images[0] ?? null;
  // The page could not be read: a screenshot of it works with every shop.
  const offerScreenshot = Boolean(onScreenshot) && (errorCode === 'fetch_failed' || (preview && !preview.extracted));

  const errorMessage = errorCode
    ? t.has(`errors.${errorCode}`)
      ? t(`errors.${errorCode}`)
      : t('errors.fetch_failed')
    : null;

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="shop-link" className="font-bold">
          {t('label')}
        </Label>
        {/* Text, not url: what a shop app's «Compartir» copies is a whole sentence
            with the link inside, and the server finds the link in it. */}
        <Input
          id="shop-link"
          type="text"
          inputMode="url"
          autoComplete="url"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder={t('placeholder')}
        />
        <p className="text-xs text-muted-foreground">{t('hint')}</p>
      </div>

      {errorMessage && (
        <Alert variant="destructive">
          <AlertDescription>{errorMessage}</AlertDescription>
        </Alert>
      )}

      {offerScreenshot && (
        <div className="flex items-start gap-3 rounded-lg bg-signature-soft p-3">
          <ImagePlus className="mt-0.5 h-5 w-5 shrink-0" strokeWidth={1.75} aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">{t('tryScreenshot')}</p>
            <Button type="button" size="sm" variant="secondary" className="mt-2" onClick={onScreenshot}>
              {t('useScreenshot')}
            </Button>
          </div>
        </div>
      )}

      {preview && (
        <div className="space-y-3 rounded-lg bg-panel p-3">
          <div className="flex gap-3">
            {shown ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={shown.data_url}
                alt={preview.name ?? t('previewAlt')}
                className="h-24 w-24 shrink-0 rounded-tile bg-background object-contain p-1"
              />
            ) : (
              <span className="flex h-24 w-24 shrink-0 items-center justify-center rounded-tile bg-background text-muted-foreground">
                <Link2 className="h-6 w-6" strokeWidth={1.75} />
              </span>
            )}
            <div className="min-w-0 space-y-1">
              <p className="break-words text-sm font-bold text-foreground">
                {preview.name || t('noName')}
              </p>
              {preview.brand && (
                <p className="text-xs text-muted-foreground">{preview.brand}</p>
              )}
              {formatPrice(preview.price, preview.currency, locale) && (
                <p className="text-xs text-muted-foreground">
                  {formatPrice(preview.price, preview.currency, locale)}
                </p>
              )}
              <p className="break-all text-xs text-muted-foreground">
                {hostOf(preview.source_url)}
              </p>
            </div>
          </div>

          {images.length > 1 && (
            <div>
              <p className="mb-1.5 text-[12px] font-semibold text-muted-foreground">{t('whichPhoto')}</p>
              <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 pt-1">
                {images.map((image, i) => (
                  <button
                    key={i}
                    type="button"
                    aria-pressed={photo === i}
                    aria-label={t('photoN', { n: i + 1 })}
                    onClick={() => setPhoto(i)}
                    className={cn(
                      'relative h-16 w-14 shrink-0 overflow-hidden rounded-quick bg-background ring-offset-2 ring-offset-panel focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      photo === i && 'ring-2 ring-foreground'
                    )}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={image.data_url} alt="" className="absolute inset-0 h-full w-full object-contain" />
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* A reminder of the sizes the user usually orders, so they can pick
              the right one on the shop's own page. Nothing is ordered here. */}
          {hasSizes(habitualSizes.saved) && (
            <div className="flex items-start gap-2 rounded-quick bg-background p-2.5" data-testid="link-sizes">
              <Ruler className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={2} aria-hidden />
              <div className="min-w-0">
                <p className="break-words text-xs font-semibold text-foreground">
                  {tSizes('atShop', { list: sizeSummary(habitualSizes.saved) })}
                </p>
                <p className="mt-0.5 break-words text-xs text-muted-foreground">{tSizes('atShopHint')}</p>
              </div>
            </div>
          )}

          {/* With the screenshot offer above, this would say the same thing twice. */}
          {!preview.extracted && !offerScreenshot && (
            <Alert variant="signature">
              <AlertDescription>{t('notExtracted')}</AlertDescription>
            </Alert>
          )}
        </div>
      )}

      <div className="flex flex-wrap justify-end gap-2 pt-2">
        <Button type="button" variant="secondary" onClick={onCancel}>
          {t('cancel')}
        </Button>
        {preview ? (
          <Button type="button" onClick={use}>
            {preview.extracted ? t('use') : t('useAnyway')}
          </Button>
        ) : (
          <Button type="submit" disabled={!url.trim() || linkPreview.isPending}>
            {linkPreview.isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} />
                {t('reading')}
              </>
            ) : (
              t('read')
            )}
          </Button>
        )}
      </div>
    </form>
  );
}
