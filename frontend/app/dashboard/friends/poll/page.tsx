'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { ArrowLeft, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/empty-state';
import { OutfitFlatLay } from '@/components/outfits/outfit-flat-lay';
import { useOutfits } from '@/lib/hooks/use-outfits';
import { useCreatePoll, useFriendsOverview } from '@/lib/hooks/use-social';
import { haptic } from '@/lib/native/haptics';
import { cn } from '@/lib/utils';

const MAX_OPTIONS = 3;

/** «¿Cuál me pongo?»: pick two or three of your looks and ask your friends. */
export default function NewPollPage() {
  const t = useTranslations('social.polls');
  const router = useRouter();
  const { data, isLoading } = useOutfits({}, 1, 30);
  const { data: overview } = useFriendsOverview();
  const create = useCreatePoll();
  const [picked, setPicked] = useState<string[]>([]);
  const [question, setQuestion] = useState('');

  const looks = (data?.outfits ?? []).filter((o) => o.items.length > 0);
  const hasFriends = (overview?.friends.length ?? 0) > 0;

  const toggle = (id: string) => {
    haptic(6);
    setPicked((cur) =>
      cur.includes(id) ? cur.filter((x) => x !== id) : cur.length >= MAX_OPTIONS ? cur : [...cur, id]
    );
  };

  const send = () =>
    create.mutate(
      { outfit_ids: picked, question: question.trim() || undefined },
      {
        onSuccess: () => {
          toast.success(t('sent'));
          router.push('/dashboard/friends');
        },
        onError: () => toast.error(t('sendError')),
      }
    );

  return (
    <div className="mx-auto max-w-2xl space-y-5 pb-40 pt-2">
      <Button variant="ghost" asChild className="-ml-3 text-muted-foreground hover:text-foreground">
        <Link href="/dashboard/friends">
          <ArrowLeft className="h-4 w-4" aria-hidden />
          {t('back')}
        </Link>
      </Button>
      <header className="px-1">
        <h1 className="text-[28px] font-extrabold leading-tight tracking-tight">{t('newTitle')}</h1>
        <p className="mt-1 text-[15px] text-muted-foreground">{t('newBody')}</p>
      </header>

      {!hasFriends && overview && <p className="rounded-lg bg-signature-soft p-3 text-sm">{t('noFriends')}</p>}

      <div className="space-y-2 px-1">
        <Label htmlFor="poll-question" className="font-bold">
          {t('questionLabel')}
        </Label>
        <Input
          id="poll-question"
          maxLength={140}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder={t('questionPlaceholder')}
        />
      </div>

      <p className="px-1 text-sm font-semibold">{t('pickLooks', { count: picked.length, max: MAX_OPTIONS })}</p>
      {isLoading ? (
        <div className="grid grid-cols-2 gap-3">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="aspect-[4/5] rounded-lg" />
          ))}
        </div>
      ) : looks.length < 2 ? (
        <EmptyState state="sleepy" title={t('fewLooksTitle')} description={t('fewLooksBody')} />
      ) : (
        <ul className="grid grid-cols-2 gap-3">
          {looks.map((look) => {
            const n = picked.indexOf(look.id);
            return (
              <li key={look.id}>
                <button
                  type="button"
                  aria-pressed={n >= 0}
                  onClick={() => toggle(look.id)}
                  className={cn(
                    'pressable relative block w-full overflow-hidden rounded-lg bg-panel p-1.5 text-left ring-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    n >= 0 && 'ring-2 ring-foreground'
                  )}
                >
                  <OutfitFlatLay items={look.items} backToggle={false} label={look.name ?? ''} sizes="45vw" />
                  {n >= 0 && (
                    <span className="absolute right-2.5 top-2.5 flex h-7 w-7 items-center justify-center rounded-full bg-foreground text-sm font-bold text-background">
                      {n + 1}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <div className="fixed bottom-float-1 left-1/2 z-float w-[calc(100vw-2rem)] max-w-xl -translate-x-1/2 lg:bottom-6 lg:ml-32">
        <Button size="lg" className="w-full shadow-lg" disabled={picked.length < 2 || create.isPending} onClick={send}>
          {create.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
          {t('send')}
        </Button>
      </div>
    </div>
  );
}
