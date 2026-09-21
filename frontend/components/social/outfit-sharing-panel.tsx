'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Globe, Heart, Lock, Users, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PersonAvatar } from '@/components/social/person-avatar';
import {
  useOutfitReactions,
  useSetOutfitVisibility,
  type OutfitVisibility,
} from '@/lib/hooks/use-social';

const OPTIONS: { value: OutfitVisibility; icon: LucideIcon }[] = [
  { value: 'private', icon: Lock },
  { value: 'friends', icon: Users },
  { value: 'public', icon: Globe },
];

/** Owner-only: who can see this look, and what friends said about it. */
export function OutfitSharingPanel({
  outfitId,
  visibility = 'private',
}: {
  outfitId: string;
  visibility?: OutfitVisibility;
}) {
  const t = useTranslations('social.visibility');
  const tR = useTranslations('social.reactions');
  const format = useFormatter();
  const setVisibility = useSetOutfitVisibility();
  const reactions = useOutfitReactions(outfitId);
  const list = reactions.data ?? [];

  const choose = (value: OutfitVisibility) => {
    if (value === visibility || setVisibility.isPending) return;
    setVisibility.mutate(
      { outfitId, visibility: value },
      {
        onSuccess: () => toast.success(t(`toast.${value}`)),
        onError: () => toast.error(t('error')),
      }
    );
  };

  return (
    <section className="space-y-4 rounded-lg bg-panel p-4 sm:p-5" aria-labelledby="sharing-title">
      <div>
        <h2 id="sharing-title" className="text-lg font-bold">
          {t('title')}
        </h2>
        <p className="text-sm text-muted-foreground">{t(`hint.${visibility}`)}</p>
      </div>
      <div role="radiogroup" aria-labelledby="sharing-title" className="grid grid-cols-3 gap-1 rounded-full bg-background p-1">
        {OPTIONS.map(({ value, icon: Icon }) => {
          const active = value === visibility;
          return (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => choose(value)}
              disabled={setVisibility.isPending}
              className={cn(
                'flex h-11 items-center justify-center gap-1.5 rounded-full text-sm font-semibold transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                active ? 'bg-signature text-signature-foreground' : 'text-foreground hover:bg-accent'
              )}
            >
              <Icon className="h-4 w-4" strokeWidth={active ? 2 : 1.75} aria-hidden />
              {t(`option.${value}`)}
            </button>
          );
        })}
      </div>

      {list.length > 0 && (
        <div className="space-y-2">
          <h3 className="flex items-center gap-1.5 text-[15px] font-bold">
            <Heart className="h-4 w-4 fill-signature text-signature" aria-hidden />
            {tR('count', { count: list.length })}
          </h3>
          <ul className="space-y-2">
            {list.map((r) => (
              <li key={r.id} className="flex items-start gap-3 rounded-2xl bg-background p-3">
                <PersonAvatar user={r.user} size={36} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm">
                    <strong className="font-bold">{r.user.display_name}</strong>{' '}
                    <span className="text-muted-foreground">
                      {r.comment ? tR('commentedShort') : tR('lovedShort')}
                    </span>
                  </p>
                  {r.comment && <p className="mt-0.5 break-words text-[15px]">{r.comment}</p>}
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {format.relativeTime(new Date(r.updated_at ?? r.created_at))}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
