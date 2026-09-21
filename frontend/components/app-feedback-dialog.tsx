'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { ImagePlus, Loader2, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { PillGroup } from '@/components/admin/shared';
import { getApiErrorCode } from '@/lib/ai-access';
import { type FeedbackKind, appBuildId } from '@/lib/admin';
import { useSubmitAppFeedback } from '@/lib/hooks/use-admin';

const MAX_SCREENSHOT_MB = 5;
const ACCEPTED = ['image/png', 'image/jpeg', 'image/webp'];

/** "Enviar sugerencia o fallo": text + optional screenshot; page/build/UA attached automatically. */
export function AppFeedbackDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useTranslations('appFeedback');
  const submit = useSubmitAppFeedback();
  const [kind, setKind] = useState<FeedbackKind>('suggestion');
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!file) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  useEffect(() => {
    if (!open) {
      setText('');
      setFile(null);
      setFileError(null);
      setKind('suggestion');
    }
  }, [open]);

  const pick = (f: File | undefined) => {
    setFileError(null);
    if (!f) return;
    if (!ACCEPTED.includes(f.type)) {
      setFileError(t('fileType'));
      return;
    }
    if (f.size > MAX_SCREENSHOT_MB * 1024 * 1024) {
      setFileError(t('fileTooLarge', { mb: MAX_SCREENSHOT_MB }));
      return;
    }
    setFile(f);
  };

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    try {
      await submit.mutateAsync({
        kind,
        text: text.trim(),
        screenshot: file,
        page_url: typeof window !== 'undefined' ? window.location.href : null,
        build_id: appBuildId(),
      });
      toast.success(t('sent'));
      onOpenChange(false);
    } catch (err) {
      const code = getApiErrorCode(err);
      toast.error(code && t.has(`errors.${code}`) ? t(`errors.${code}`) : t('error'));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={send} className="space-y-4">
          <DialogHeader className="pr-10 text-left">
            <DialogTitle>{t('title')}</DialogTitle>
            <DialogDescription>{t('description')}</DialogDescription>
          </DialogHeader>

          <PillGroup<FeedbackKind>
            label={t('kindLabel')}
            value={kind}
            onChange={setKind}
            options={[
              { value: 'suggestion', label: t('kinds.suggestion') },
              { value: 'bug', label: t('kinds.bug') },
              { value: 'other', label: t('kinds.other') },
            ]}
          />

          <div className="space-y-1.5">
            <label htmlFor="app-feedback-text" className="block px-1 text-sm font-bold">
              {t(`textLabel.${kind}`)}
            </label>
            <Textarea
              id="app-feedback-text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={5}
              maxLength={5000}
              required
              placeholder={t(`placeholder.${kind}`)}
            />
          </div>

          <div className="space-y-2">
            <input
              ref={inputRef}
              type="file"
              accept={ACCEPTED.join(',')}
              className="sr-only"
              id="app-feedback-file"
              onChange={(e) => {
                pick(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
            {preview ? (
              <div className="flex items-center gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={preview} alt={t('screenshotPreview')} className="h-20 w-20 rounded-tile object-cover" />
                <Button type="button" variant="secondary" size="sm" onClick={() => setFile(null)}>
                  <X className="h-4 w-4" aria-hidden />
                  {t('removeScreenshot')}
                </Button>
              </div>
            ) : (
              <Button type="button" variant="outline" size="sm" onClick={() => inputRef.current?.click()}>
                <ImagePlus className="h-4 w-4" aria-hidden />
                {t('addScreenshot')}
              </Button>
            )}
            {fileError && (
              <p role="alert" className="px-1 text-sm font-medium text-destructive">
                {fileError}
              </p>
            )}
            <p className="px-1 text-xs text-muted-foreground">{t('contextNote')}</p>
          </div>

          <Button type="submit" className="w-full" disabled={!text.trim() || submit.isPending}>
            {submit.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            {t('send')}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
