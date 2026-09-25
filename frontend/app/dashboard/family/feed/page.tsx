'use client';

import { useState } from 'react';
import { useSession } from 'next-auth/react';
import {
  Loader2,
  Users,
  Star,
  ChevronRight,
  Settings,
  Calendar,
  Zap,
  Edit3,
  MessageCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Skeleton } from '@/components/ui/skeleton';
import { useFormatter, useTranslations } from 'next-intl';
import { useClothingTypeLabel } from '@/lib/clothing-type-label';
import { useFamily } from '@/lib/hooks/use-family';
import { useFamilyOutfits, type Outfit, type OutfitSource } from '@/lib/hooks/use-outfits';
import { FamilyRatingForm, FamilyRatingsDisplay } from '@/components/family-ratings';
import { OutfitPreviewDialog } from '@/components/outfit-preview-dialog';
import Image from 'next/image';
import Link from 'next/link';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/empty-state';
import { cn } from '@/lib/utils';

function getInitials(name: string) {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

function SourceBadge({ source }: { source: OutfitSource }) {
  const t = useTranslations('familyFeed');
  const config: Record<
    OutfitSource,
    { icon: typeof Calendar; label: string; variant: 'sky' | 'amber' | 'mint' | 'signature' }
  > = {
    scheduled: { icon: Calendar, label: t('sourceScheduled'), variant: 'sky' },
    on_demand: { icon: Zap, label: t('sourceOnDemand'), variant: 'amber' },
    manual: { icon: Edit3, label: t('sourceManual'), variant: 'mint' },
    pairing: { icon: Zap, label: t('sourcePairing'), variant: 'signature' },
    stinky_chat: { icon: MessageCircle, label: t('sourceStinky'), variant: 'signature' },
  };

  const { icon: Icon, label, variant } = config[source];

  return (
    <Badge variant={variant}>
      <Icon className="h-3 w-3" strokeWidth={2} aria-hidden />
      {label}
    </Badge>
  );
}

function FeedOutfitCard({
  outfit,
  currentMemberId,
  memberName,
  onPreview,
}: {
  outfit: Outfit;
  currentMemberId?: string;
  memberName: string;
  onPreview: () => void;
}) {
  const t = useTranslations('familyFeed');
  const format = useFormatter();
  const typeLabel = useClothingTypeLabel();
  const [showRatingForm, setShowRatingForm] = useState(false);
  const myRating = outfit.family_ratings?.find((r) => r.user_id === currentMemberId);

  return (
    <Card className="overflow-hidden">
      <CardContent className="space-y-3 p-4 sm:p-5">
        {/* Header */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <SourceBadge source={outfit.source} />
            <Badge variant="secondary" className="capitalize">
              {outfit.occasion}
            </Badge>
          </div>
          <span className="text-xs text-muted-foreground">
            {outfit.scheduled_for ? format.dateTime(new Date(outfit.scheduled_for + 'T00:00:00'), {
              month: 'short',
              day: 'numeric',
              year: 'numeric',
            }) : t('lookbook')
            }
          </span>
        </div>

        {/* Item thumbnails - clickable */}
        <button
          type="button"
          onClick={onPreview}
          aria-label={t('previewOutfit')}
          className="group flex w-full gap-2 overflow-x-auto rounded-tile text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          {outfit.items.map((item) => (
            <div
              key={item.id}
              className="relative h-20 w-20 shrink-0 overflow-hidden rounded-tile bg-panel transition-transform duration-150 group-hover:scale-[1.02]"
            >
              {item.thumbnail_url ? (
                <Image
                  src={item.thumbnail_url}
                  alt={item.name || typeLabel(item.type)}
                  fill
                  className="object-cover"
                  sizes="80px"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center p-1 text-center text-xs text-muted-foreground">
                  {typeLabel(item.type)}
                </div>
              )}
            </div>
          ))}
        </button>

        {/* AI reasoning */}
        {outfit.reasoning && (
          <p className="text-sm text-muted-foreground">{outfit.reasoning}</p>
        )}

        {/* Family ratings summary */}
        {outfit.family_rating_count != null && outfit.family_rating_count > 0 && (
          <div className="flex items-center gap-2 text-sm">
            <Users className="h-4 w-4 text-muted-foreground" strokeWidth={1.75} aria-hidden />
            <div
              className="flex gap-0.5"
              role="img"
              aria-label={t('starsLabel', { count: Math.round(outfit.family_rating_average ?? 0) })}
            >
              {[1, 2, 3, 4, 5].map((star) => (
                <Star
                  key={star}
                  aria-hidden
                  className={cn(
                    'h-4 w-4',
                    star <= Math.round(outfit.family_rating_average ?? 0)
                      ? 'fill-pop-amber text-pop-amber'
                      : 'text-muted-foreground/30'
                  )}
                />
              ))}
            </div>
            <span className="text-muted-foreground text-xs">
              {t('ratingsCountShort', { count: outfit.family_rating_count ?? 0 })}
            </span>
          </div>
        )}

        {/* All family ratings */}
        {outfit.family_ratings && outfit.family_ratings.length > 0 && (
          <FamilyRatingsDisplay
            ratings={outfit.family_ratings}
            outfitId={outfit.id}
            currentUserId={currentMemberId}
          />
        )}

        {/* Rating action */}
        {!myRating ? (
          showRatingForm ? (
            <div className="border-t border-border pt-3">
              <FamilyRatingForm
                outfitId={outfit.id}
                onSuccess={() => setShowRatingForm(false)}
              />
            </div>
          ) : (
            <Button
              variant="secondary"
              className="w-full"
              onClick={() => setShowRatingForm(true)}
            >
              <Star className="h-4 w-4" strokeWidth={1.75} />
              {t('rateOutfitOf', { name: memberName })}
            </Button>
          )
        ) : (
          <div className="flex items-center justify-between gap-2 border-t border-border pt-3">
            <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm">
              <span className="text-muted-foreground">{t('yourRating')}</span>
              <div className="flex gap-0.5" role="img" aria-label={t('starsLabel', { count: myRating.rating })}>
                {[1, 2, 3, 4, 5].map((star) => (
                  <Star
                    key={star}
                    aria-hidden
                    className={cn(
                      'h-4 w-4',
                      star <= myRating.rating ? 'fill-pop-amber text-pop-amber' : 'text-muted-foreground/30'
                    )}
                  />
                ))}
              </div>
              {myRating.comment && (
                <span className="text-xs text-muted-foreground truncate max-w-[200px]">
                  &ldquo;{myRating.comment}&rdquo;
                </span>
              )}
            </div>
            <Button
              size="sm"
              variant="ghost"
              className="h-11 shrink-0"
              onClick={() => setShowRatingForm(!showRatingForm)}
            >
              {t('edit')}
            </Button>
          </div>
        )}

        {/* Show edit form when editing existing rating */}
        {myRating && showRatingForm && (
          <div className="border-t border-border pt-3">
            <FamilyRatingForm
              outfitId={outfit.id}
              existingRating={myRating}
              onSuccess={() => setShowRatingForm(false)}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ManageFamilyButton() {
  const t = useTranslations('familyFeed');
  return (
    <Button variant="outline" asChild>
      <Link href="/dashboard/family">
        <Settings className="h-4 w-4" strokeWidth={1.75} />
        {t('manageFamily')}
      </Link>
    </Button>
  );
}

function NoFamilyState() {
  const t = useTranslations('familyFeed');
  return (
    <div className="mx-auto max-w-5xl space-y-6 py-2 sm:py-4">
      <PageHeader title={t('title')} description={t('subtitle')} />

      <EmptyState
        state="sleepy"
        title={t('joinFirstTitle')}
        description={t('joinFirstBody')}
        action={
          <Button asChild>
            <Link href="/dashboard/family">
              <Users className="h-4 w-4" strokeWidth={1.75} />
              {t('setUpFamily')}
            </Link>
          </Button>
        }
      />
    </div>
  );
}

function FeedContent() {
  const t = useTranslations('familyFeed');
  const { data: session } = useSession();
  const { data: family, isLoading: familyLoading } = useFamily();
  const currentEmail = session?.user?.email;
  const currentMember = family?.members.find((m) => m.email === currentEmail);
  const otherMembers = family?.members.filter((m) => m.email !== currentEmail) ?? [];

  const [selectedMember, setSelectedMember] = useState<string | undefined>(undefined);
  const [previewOutfit, setPreviewOutfit] = useState<Outfit | null>(null);

  // Auto-select first member when family loads
  const activeMemberId = selectedMember ?? (otherMembers.length > 0 ? otherMembers[0].id : undefined);
  const { data, isLoading } = useFamilyOutfits(activeMemberId);

  const selectedMemberInfo = otherMembers.find((m) => m.id === activeMemberId);

  if (familyLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!family) {
    return <NoFamilyState />;
  }

  if (otherMembers.length === 0) {
    return (
      <div className="mx-auto max-w-5xl space-y-6 py-2 sm:py-4">
        <PageHeader title={t('title')} description={t('subtitle')} action={<ManageFamilyButton />} />

        <EmptyState
          state="sleepy"
          title={t('noOtherMembersTitle')}
          description={t('noOtherMembersBody')}
          action={
            <Button asChild>
              <Link href="/dashboard/family">{t('inviteMembers')}</Link>
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 py-2 sm:py-4">
      <PageHeader title={t('title')} description={t('subtitle')} action={<ManageFamilyButton />} />

      {/* Member selector */}
      <div className="-mx-1 flex gap-2 overflow-x-auto scrollbar-none px-1 pb-2">
        {otherMembers.map((member) => (
          <button
            key={member.id}
            type="button"
            onClick={() => setSelectedMember(member.id)}
            aria-pressed={activeMemberId === member.id}
            className={cn(
              'flex min-w-[84px] shrink-0 flex-col items-center gap-1.5 rounded-quick p-3 transition-colors duration-150',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
              activeMemberId === member.id ? 'bg-signature text-signature-foreground' : 'bg-panel hover:bg-accent'
            )}
          >
            <Avatar className="h-12 w-12">
              <AvatarImage src={member.avatar_url} />
              <AvatarFallback>{getInitials(member.display_name)}</AvatarFallback>
            </Avatar>
            <span
              className={cn(
                'max-w-[72px] truncate text-xs',
                activeMemberId === member.id ? 'font-bold' : 'font-medium text-muted-foreground'
              )}
            >
              {member.display_name.split(' ')[0]}
            </span>
          </button>
        ))}
      </div>

      {/* Outfits feed */}
      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i}>
              <CardContent className="p-4 space-y-3">
                <div className="flex gap-2">
                  <Skeleton className="h-5 w-20 rounded-full" />
                  <Skeleton className="h-5 w-16 rounded-full" />
                </div>
                <div className="flex gap-2">
                  <Skeleton className="h-20 w-20 rounded-tile" />
                  <Skeleton className="h-20 w-20 rounded-tile" />
                  <Skeleton className="h-20 w-20 rounded-tile" />
                </div>
                <Skeleton className="h-11 w-full rounded-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : !data || data.outfits.length === 0 ? (
        <EmptyState
          state="sleepy"
          size="sm"
          title={t('noOutfitsTitle')}
          description={
            selectedMemberInfo
              ? t('noOutfitsBody', { name: selectedMemberInfo.display_name })
              : t('noOutfitsBodyGeneric')
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {data.outfits.map((outfit) => (
            <FeedOutfitCard
              key={outfit.id}
              outfit={outfit}
              currentMemberId={currentMember?.id}
              memberName={selectedMemberInfo?.display_name.split(' ')[0] ?? ''}
              onPreview={() => setPreviewOutfit(outfit)}
            />
          ))}
        </div>
      )}

      {/* Preview dialog */}
      {previewOutfit && (
        <OutfitPreviewDialog
          outfit={previewOutfit}
          open={!!previewOutfit}
          onClose={() => setPreviewOutfit(null)}
          isOwner={false}
        />
      )}
    </div>
  );
}

export default function FamilyFeedPage() {
  return <FeedContent />;
}
