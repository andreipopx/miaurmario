'use client';

import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Check, Clock, Loader2, UserMinus, UserPlus, X } from 'lucide-react';
import { ApiError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import {
  useAcceptFriend,
  useRemoveFriendship,
  useSendFriendRequest,
  type Relation,
} from '@/lib/hooks/use-social';

/** Maps friendship API error codes to messages. */
export function useFriendErrorMessage() {
  const t = useTranslations('social.errors');
  return (error: unknown): string => {
    if (error instanceof ApiError) {
      const code = typeof (error.data as { detail?: unknown })?.detail === 'string'
        ? ((error.data as { detail: string }).detail)
        : '';
      if (code === 'username_required') return t('usernameRequired');
      if (code === 'already_friends') return t('alreadyFriends');
      if (code === 'already_requested') return t('alreadyRequested');
      if (code === 'you_blocked_user') return t('youBlocked');
      if (code === 'self_friendship') return t('self');
      if (error.status === 404) return t('notFound');
      if (error.status === 429) return t('tooMany');
    }
    return t('generic');
  };
}

/**
 * The primary action for someone, given our relation:
 * none → "Añadir a tus amigos" · outgoing → pending (cancel) · incoming → accept/decline
 * · friends → remove (optional).
 */
export function RelationActions({
  username,
  relation,
  friendshipId,
  onAccepted,
  showRemove = false,
  size = 'default',
  compact = false,
}: {
  username: string;
  relation: Relation;
  friendshipId: string | null;
  onAccepted?: () => void;
  showRemove?: boolean;
  size?: 'default' | 'sm' | 'lg';
  /** Short "Añadir" label for tight rows. */
  compact?: boolean;
}) {
  const t = useTranslations('social.actions');
  const errorMessage = useFriendErrorMessage();
  const send = useSendFriendRequest();
  const accept = useAcceptFriend();
  const remove = useRemoveFriendship();

  const onError = (e: unknown) => toast.error(errorMessage(e));

  if (relation === 'none') {
    return (
      <Button
        size={size}
        variant="signature"
        disabled={send.isPending}
        onClick={() =>
          send.mutate(username, {
            onSuccess: (f) => {
              if (f.relation === 'friends') {
                toast.success(t('nowFriends', { name: '@' + f.user.username }));
                onAccepted?.();
              } else toast.success(t('requestSent'));
            },
            onError,
          })
        }
      >
        {send.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <UserPlus className="h-4 w-4" strokeWidth={2} aria-hidden />}
        {compact ? t('addShort') : t('add')}
      </Button>
    );
  }

  if (relation === 'outgoing' && friendshipId) {
    return (
      <div className="flex items-center gap-2">
        <span className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
          <Clock className="h-4 w-4" strokeWidth={2} aria-hidden />
          {t('pending')}
        </span>
        <Button
          size={size}
          variant="secondary"
          disabled={remove.isPending}
          onClick={() => remove.mutate(friendshipId, { onSuccess: () => toast.success(t('requestCancelled')), onError })}
          aria-label={t('cancelRequestLabel')}
        >
          <X className="h-4 w-4" strokeWidth={2} aria-hidden />
          {t('cancelRequest')}
        </Button>
      </div>
    );
  }

  if (relation === 'incoming' && friendshipId) {
    return (
      <div className="flex gap-2">
        <Button
          size={size}
          disabled={accept.isPending}
          onClick={() =>
            accept.mutate(friendshipId, {
              onSuccess: (f) => {
                toast.success(t('nowFriends', { name: '@' + f.user.username }));
                onAccepted?.();
              },
              onError,
            })
          }
        >
          {accept.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Check className="h-4 w-4" strokeWidth={2.25} aria-hidden />}
          {t('accept')}
        </Button>
        <Button
          size={size}
          variant="secondary"
          disabled={remove.isPending}
          onClick={() => remove.mutate(friendshipId, { onError })}
          aria-label={t('declineLabel')}
        >
          <X className="h-4 w-4" strokeWidth={2} aria-hidden />
          {t('decline')}
        </Button>
      </div>
    );
  }

  if (relation === 'friends' && friendshipId && showRemove) {
    return (
      <Button
        size={size}
        variant="outline"
        disabled={remove.isPending}
        onClick={() => {
          if (!confirm(t('confirmRemove'))) return;
          remove.mutate(friendshipId, { onSuccess: () => toast.success(t('removed')), onError });
        }}
      >
        <UserMinus className="h-4 w-4" strokeWidth={1.75} aria-hidden />
        {t('remove')}
      </Button>
    );
  }

  return null;
}
