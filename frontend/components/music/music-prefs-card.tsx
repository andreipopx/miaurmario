'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import {
  useDeleteMusicHistory,
  useMusicSettings,
  useUpdateMusicContrast,
} from '@/lib/hooks/use-music';

/**
 * Music preferences shared by the Música tab and the Spotify / Last.fm pages:
 * the "contrast my music" toggle (off by default) and "delete my history".
 */
export function MusicPrefsCard({ className }: { className?: string }) {
  const t = useTranslations('music.prefs');
  const settings = useMusicSettings();
  const updateContrast = useUpdateMusicContrast();
  const deleteHistory = useDeleteMusicHistory();
  const [confirmOpen, setConfirmOpen] = useState(false);

  return (
    <section aria-labelledby="music-prefs-title" className={cn('space-y-4 rounded-lg bg-panel p-5 sm:p-6', className)}>
      <h2 id="music-prefs-title" className="text-[15px] font-bold sm:text-lg">
        {t('title')}
      </h2>

      <div className="flex items-start justify-between gap-6">
        <div className="space-y-1">
          <Label htmlFor="music-contrast" className="text-[15px] font-bold">
            {t('contrast')}
          </Label>
          <p className="text-sm text-muted-foreground">{t('contrastHelp')}</p>
        </div>
        <Switch
          id="music-contrast"
          checked={settings.data?.contrast ?? false}
          disabled={!settings.data || updateContrast.isPending}
          onCheckedChange={(checked) =>
            updateContrast.mutate(checked, { onError: () => toast.error(t('contrastFailed')) })
          }
        />
      </div>
      <p className="text-xs text-muted-foreground">{t('privacyNote')}</p>

      <div className="flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <p className="text-[15px] font-bold">{t('deleteTitle')}</p>
          <p className="text-sm text-muted-foreground">{t('deleteHelp')}</p>
        </div>
        <Button
          variant="outline"
          className="shrink-0"
          onClick={() => setConfirmOpen(true)}
          disabled={deleteHistory.isPending}
        >
          {deleteHistory.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <Trash2 className="h-4 w-4" strokeWidth={1.75} aria-hidden />
          )}
          {t('deleteButton')}
        </Button>
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('deleteConfirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('deleteConfirmBody')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                deleteHistory.mutate(undefined, {
                  onSuccess: () => toast.success(t('deleted')),
                  onError: () => toast.error(t('deleteFailed')),
                })
              }
            >
              {t('deleteConfirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
