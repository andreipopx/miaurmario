'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { LinkPreview, dataUrlToFile, useLinkPreview } from '@/lib/hooks/use-intake';
import { ApiError } from '@/lib/api';

export interface LinkPrefill {
  file: File | null;
  name: string;
  brand: string;
  primaryColor: string;
  sourceUrl: string;
}

interface LinkImportTabProps {
  initialUrl?: string | null;
  onUse: (prefill: LinkPrefill) => void;
  onCancel: () => void;
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
export function LinkImportTab({ initialUrl, onUse, onCancel }: LinkImportTabProps) {
  const t = useTranslations('wardrobe.add.link');
  const [url, setUrl] = useState(initialUrl ?? '');
  const [preview, setPreview] = useState<LinkPreview | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const linkPreview = useLinkPreview();

  useEffect(() => {
    if (initialUrl) setUrl(initialUrl);
  }, [initialUrl]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const candidate = url.trim();
    if (!candidate) return;
    setPreview(null);
    setErrorCode(null);
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
    if (preview.image) {
      try {
        file = await dataUrlToFile(preview.image.data_url, 'prenda');
      } catch {
        file = null;
      }
    }
    onUse({
      file,
      name: preview.name ?? '',
      brand: preview.brand ?? '',
      primaryColor: preview.primary_color ?? '',
      sourceUrl: preview.source_url,
    });
  };

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
        <Input
          id="shop-link"
          type="url"
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

      {preview && (
        <div className="space-y-3 rounded-lg bg-panel p-3">
          <div className="flex gap-3">
            {preview.image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={preview.image.data_url}
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
              {preview.price && (
                <p className="text-xs text-muted-foreground">
                  {preview.price}
                  {preview.currency ? ` ${preview.currency}` : ''}
                </p>
              )}
              <p className="break-all text-xs text-muted-foreground">
                {hostOf(preview.source_url)}
              </p>
            </div>
          </div>

          {!preview.extracted && (
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
