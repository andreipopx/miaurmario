'use client';

import { useTranslations } from 'next-intl';

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';

/** Disconnect a music source, choosing whether to keep the plays imported from it. */
export function DisconnectMusicDialog({
  open,
  onOpenChange,
  source,
  pending,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Display name ("Spotify", "Last.fm"). */
  source: string;
  pending?: boolean;
  onConfirm: (keepHistory: boolean) => void;
}) {
  const t = useTranslations('integrations.disconnectMusic');
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('title', { source })}</AlertDialogTitle>
          <AlertDialogDescription>{t('description', { source })}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="gap-2">
          <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
          <Button variant="outline" disabled={pending} onClick={() => onConfirm(false)}>
            {t('delete')}
          </Button>
          <Button disabled={pending} onClick={() => onConfirm(true)}>
            {t('keep')}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
