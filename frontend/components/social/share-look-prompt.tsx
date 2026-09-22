'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Loader2, Users, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { LazyStinky } from '@/components/native/lazy-stinky';
import { useShareOutfit, useUnshareOutfit } from '@/lib/hooks/use-social';

/**
 * Shown on Hoy right after "Me lo pongo": offer to share the look with friends.
 * Sharing is per outfit, so a second look later the same day can be shared too.
 */
export function ShareLookPrompt({
  outfitId,
  alreadyShared = false,
  onDismiss,
}: {
  outfitId: string;
  alreadyShared?: boolean;
  onDismiss: () => void;
}) {
  const t = useTranslations('social.shareLook');
  const share = useShareOutfit();
  const unshare = useUnshareOutfit();
  const shared = alreadyShared || share.isSuccess;

  return (
    <section
      aria-live="polite"
      aria-labelledby="share-look-title"
      className="relative flex items-center gap-3 rounded-lg bg-signature-soft p-3.5 pr-12"
    >
      <LazyStinky state={shared ? 'happy' : 'idle'} size={64} label="" className="shrink-0" />
      <div className="min-w-0 flex-1">
        <h2 id="share-look-title" className="text-[15px] font-bold">
          {shared ? t('sharedTitle') : t('title')}
        </h2>
        <p className="mt-0.5 text-sm text-foreground/75">{shared ? t('sharedBody') : t('body')}</p>
        <div className="mt-2.5 flex flex-wrap gap-2">
          {shared ? (
            <>
              <Button asChild size="sm">
                <Link href="/dashboard/friends">{t('seeFriends')}</Link>
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={unshare.isPending}
                onClick={() =>
                  unshare.mutate(outfitId, {
                    onSuccess: () => {
                      toast.success(t('unshared'));
                      onDismiss();
                    },
                    onError: () => toast.error(t('error')),
                  })
                }
              >
                {t('undo')}
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              disabled={share.isPending}
              onClick={() => share.mutate(outfitId, { onError: () => toast.error(t('error')) })}
            >
              {share.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <Users className="h-4 w-4" strokeWidth={2} aria-hidden />
              )}
              {t('cta')}
            </Button>
          )}
        </div>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label={t('dismiss')}
        className="absolute right-1.5 top-1.5 flex h-11 w-11 items-center justify-center rounded-full hover:bg-background/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <X className="h-4 w-4" strokeWidth={2} aria-hidden />
      </button>
    </section>
  );
}
