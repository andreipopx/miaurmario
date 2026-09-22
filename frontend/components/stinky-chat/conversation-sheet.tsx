'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Loader2, MessageCircle, Plus, Trash2 } from 'lucide-react';

import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import {
  useDeleteStinkyConversation,
  useStinkyConversations,
} from '@/lib/hooks/use-stinky-chat';

interface ConversationSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDeleted: (id: string) => void;
}

/** Bottom sheet (mobile) / dialog (desktop) listing past conversations. */
export function ConversationSheet({
  open,
  onOpenChange,
  activeId,
  onSelect,
  onNew,
  onDeleted,
}: ConversationSheetProps) {
  const t = useTranslations('stinkyChat');
  const format = useFormatter();
  const { data, isLoading } = useStinkyConversations(open);
  const del = useDeleteStinkyConversation();
  const conversations = data?.conversations ?? [];

  const onDelete = (id: string) => {
    del.mutate(id, {
      onSuccess: () => {
        toast.success(t('deleted'));
        onDeleted(id);
      },
      onError: () => toast.error(t('deleteError')),
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* DialogContent is already a swipe-to-close bottom sheet on phones. */}
      <DialogContent className="max-h-[80dvh] gap-3 p-4 max-sm:pt-7 sm:p-6">
        <DialogTitle>{t('history')}</DialogTitle>
        <DialogDescription className="sr-only">{t('subtitle')}</DialogDescription>
        <button
          type="button"
          onClick={onNew}
          className="flex min-h-[48px] items-center gap-3 rounded-full bg-primary px-4 text-[15px] font-semibold text-primary-foreground transition active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <Plus className="h-5 w-5" strokeWidth={2} aria-hidden />
          {t('newChat')}
        </button>
        {isLoading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden />
          </div>
        ) : conversations.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">{t('historyEmpty')}</p>
        ) : (
          <ul className="-mx-1 space-y-1 overflow-y-auto overscroll-contain">
            {conversations.map((c) => (
              <li key={c.id} className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => onSelect(c.id)}
                  aria-current={c.id === activeId ? 'true' : undefined}
                  className={cn(
                    'flex min-h-[52px] min-w-0 flex-1 items-center gap-3 rounded-2xl px-3 py-2 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    c.id === activeId && 'bg-panel'
                  )}
                >
                  <MessageCircle className="h-5 w-5 shrink-0 text-muted-foreground" strokeWidth={1.75} aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-semibold">{c.title || t('untitled')}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {format.relativeTime(new Date(c.updated_at), new Date())}
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => onDelete(c.id)}
                  disabled={del.isPending && del.variables === c.id}
                  aria-label={t('deleteConversation')}
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                >
                  {del.isPending && del.variables === c.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  ) : (
                    <Trash2 className="h-[18px] w-[18px]" strokeWidth={1.75} aria-hidden />
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
