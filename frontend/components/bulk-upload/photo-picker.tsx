'use client';

import { useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { useTranslations } from 'next-intl';
import { Camera, ImagePlus, Upload } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { LazyStinky } from '@/components/native/lazy-stinky';
import { MAX_BATCH_PHOTOS, MAX_PHOTO_MB, type RejectReason } from '@/lib/bulk-upload/queue';

interface PhotoPickerProps {
  onPick: (files: File[]) => void;
  /** Photos already queued, so the picker can say how much room is left. */
  queued: number;
  rejected: readonly RejectReason[];
  /** Hidden when the user has no AI vision: there is nothing to skip. */
  canSkipAi: boolean;
  skipAi: boolean;
  onSkipAiChange: (skip: boolean) => void;
}

/**
 * The way in: a whole camera roll selection at once on a phone, a drag and drop
 * target on a desktop. Both feed the same queue.
 */
export function PhotoPicker({
  onPick,
  queued,
  rejected,
  canSkipAi,
  skipAi,
  onSkipAiChange,
}: PhotoPickerProps) {
  const t = useTranslations('bulkUpload.picker');
  const room = Math.max(0, MAX_BATCH_PHOTOS - queued);

  const onDrop = useCallback((files: File[]) => onPick(files), [onPick]);
  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    onDrop,
    multiple: true,
    noClick: true,
    noKeyboard: true,
    accept: { 'image/*': ['.jpeg', '.jpg', '.png', '.webp', '.heic', '.heif'] },
  });

  return (
    <div className="space-y-4">
      <div
        {...getRootProps()}
        data-testid="bulk-dropzone"
        className={`rounded-lg border-2 border-dashed p-5 text-center transition-colors sm:p-7 ${
          isDragActive ? 'border-signature bg-signature-soft' : 'border-border bg-panel'
        }`}
      >
        <input {...getInputProps()} data-testid="bulk-file-input" />
        <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-background">
          <LazyStinky state="wave" settleTo="idle" size={64} label="" />
        </div>
        <p className="mt-3 text-[15px] font-bold leading-snug">
          {isDragActive ? t('dropNow') : t('headline')}
        </p>
        <p className="mt-1 text-[13px] leading-snug text-muted-foreground">
          {t('hint', { max: MAX_BATCH_PHOTOS, size: MAX_PHOTO_MB })}
        </p>

        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-center">
          <Button type="button" onClick={open} disabled={room === 0} className="w-full sm:w-auto">
            <ImagePlus className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden />
            {t('choose')}
          </Button>
          {/* A separate input so the phone opens the camera instead of the library. */}
          <Button asChild variant="secondary" className="w-full sm:w-auto">
            <label className="cursor-pointer">
              <Camera className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden />
              {t('camera')}
              <input
                type="file"
                accept="image/*"
                capture="environment"
                multiple
                className="sr-only"
                disabled={room === 0}
                onChange={(event) => {
                  onPick(Array.from(event.target.files ?? []));
                  event.target.value = '';
                }}
              />
            </label>
          </Button>
        </div>
        <p className="mt-3 text-[13px] text-muted-foreground">
          {room === 0 ? t('full', { max: MAX_BATCH_PHOTOS }) : t('room', { room })}
        </p>
      </div>

      {rejected.length > 0 && (
        <Alert variant="destructive">
          <AlertDescription className="space-y-1 text-[13px]">
            {rejected.includes('too-many') && (
              <p>{t('rejected.tooMany', { max: MAX_BATCH_PHOTOS })}</p>
            )}
            {rejected.includes('too-big') && <p>{t('rejected.tooBig', { size: MAX_PHOTO_MB })}</p>}
            {rejected.includes('wrong-type') && <p>{t('rejected.wrongType')}</p>}
          </AlertDescription>
        </Alert>
      )}

      {canSkipAi && (
        <div className="flex items-start justify-between gap-3 rounded-lg bg-panel p-3">
          <Label htmlFor="bulk-skip-ai" className="text-[14px] font-semibold leading-snug">
            {t('skipAi')}
            <span className="mt-0.5 block text-[13px] font-normal text-muted-foreground">
              {t('skipAiHint')}
            </span>
          </Label>
          <Switch id="bulk-skip-ai" checked={skipAi} onCheckedChange={onSkipAiChange} />
        </div>
      )}

      {!canSkipAi && (
        <p className="flex items-start gap-2 rounded-lg bg-panel p-3 text-[13px] leading-snug text-muted-foreground">
          <Upload className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden />
          {t('noAiHint')}
        </p>
      )}
    </div>
  );
}
