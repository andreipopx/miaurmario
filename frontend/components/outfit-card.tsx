'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { FeedOutfit } from '@/lib/hooks/use-social';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { RatingDialog } from '@/components/rating-dialog';

interface OutfitCardProps {
  outfit: FeedOutfit;
}

export function OutfitCard({ outfit }: OutfitCardProps) {
  const t = useTranslations('outfitCard');
  const [rateOpen, setRateOpen] = useState(false);
  const author = outfit.author;
  const initials = (author.display_name || author.username || '·')
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  return (
    <article className="card-editorial flex flex-col gap-4 p-5">
      <header className="flex items-center gap-3">
        <Avatar className="h-9 w-9 rounded-none border border-border-solid/60">
          <AvatarImage src={author.avatar_url || ''} alt={author.display_name} className="rounded-none" />
          <AvatarFallback className="rounded-none bg-transparent font-display text-sm">{initials}</AvatarFallback>
        </Avatar>
        <div className="flex flex-col">
          <span className="font-display italic text-base leading-tight">
            {author.username ? `@${author.username}` : author.display_name}
          </span>
          <span className="label-editorial text-muted-foreground">{outfit.occasion}</span>
        </div>
      </header>

      {outfit.name && <h3 className="font-display text-xl">{outfit.name}</h3>}
      {outfit.style_notes && <p className="text-sm text-muted-foreground">{outfit.style_notes}</p>}

      <footer className="flex items-center justify-between pt-2">
        <span className="label-editorial text-muted-foreground">
          {outfit.scheduled_for || new Date(outfit.created_at).toLocaleDateString()}
        </span>
        <Button variant="ghost" size="sm" onClick={() => setRateOpen(true)}>
          {t('rateAction')}
        </Button>
      </footer>

      <RatingDialog outfitId={outfit.id} open={rateOpen} onOpenChange={setRateOpen} />
    </article>
  );
}
