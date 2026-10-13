'use client';

import { useEffect } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Clock, Loader2, Lock, Sparkles } from 'lucide-react';
import { toast } from 'sonner';

import { useConfirm } from '@/components/confirm-provider';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/empty-state';
import {
  isReadingBoard,
  usePinterestBoards,
  usePinterestConnect,
  usePinterestDisconnect,
  usePinterestImportBoard,
  usePinterestRemoveBoard,
  usePinterestStatus,
  type PinterestBoard,
} from '@/lib/hooks/use-pinterest';

const KNOWN_ERRORS = ['invalid_state', 'access_denied', 'exchange_failed'] as const;

export default function PinterestIntegrationPage() {
  const t = useTranslations('integrations.pinterest');
  const confirm = useConfirm();
  const tI = useTranslations('integrations');
  const params = useSearchParams();
  const router = useRouter();
  const justConnected = params.get('connected') === '1';
  const errorParam = params.get('error');

  const status = usePinterestStatus();
  const connected = status.data?.connected ?? false;
  const boardsQuery = usePinterestBoards(connected);
  const connect = usePinterestConnect();
  const disconnect = usePinterestDisconnect();

  useEffect(() => {
    if (justConnected) {
      toast.success(t('connectedToast'));
      router.replace('/dashboard/settings/integrations/pinterest');
    }
  }, [justConnected, router, t]);

  const errorKey =
    errorParam && (KNOWN_ERRORS as readonly string[]).includes(errorParam)
      ? `errors.${errorParam}`
      : 'errorGeneric';

  const boards = boardsQuery.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div className="mx-auto max-w-5xl space-y-6 py-2 sm:py-4">
      <Button variant="ghost" asChild className="-ml-3 text-muted-foreground hover:text-foreground">
        <Link href="/dashboard/settings/integrations">
          {tI('backToIntegrations')}
        </Link>
      </Button>

      <PageHeader title={t('title')} description={t('tagline')} />

      {errorParam && (
        <Alert variant="destructive">
          <AlertTitle>{t('errorTitle')}</AlertTitle>
          <AlertDescription>{t(errorKey)}</AlertDescription>
        </Alert>
      )}

      {status.isLoading && (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} /> {tI('loading')}
        </div>
      )}

      {status.data && !connected && (
        <Card>
          <CardHeader>
            <CardTitle>{t('connectTitle')}</CardTitle>
            <CardDescription>{t('connectDescription')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* No Pinterest secret on the server means the app is still waiting for
                Pinterest to approve it. Same card, button just can't be pressed —
                the day the secret arrives it starts working with no other change. */}
            {!status.data.configured && (
              <p
                id="pinterest-pending"
                className="flex items-start gap-2 text-sm leading-snug text-muted-foreground"
              >
                <Clock className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden />
                {t('notConfigured')}
              </p>
            )}
            <Button
              onClick={() => connect.mutate()}
              disabled={!status.data.configured || connect.isPending}
              aria-describedby={!status.data.configured ? 'pinterest-pending' : undefined}
            >
              {connect.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} />
              ) : null}
              {t('connectButton')}
            </Button>
            <p className="eyebrow">{t('scopesNote')}</p>
          </CardContent>
        </Card>
      )}

      {status.data && connected && (
        <section className="space-y-6">
          <div className="flex flex-col gap-4 rounded-lg bg-panel p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
            <div className="space-y-1">
              <p className="eyebrow">{t('connectedAs')}</p>
              <p className="text-xl font-extrabold tracking-tight">
                {status.data.pinterest_user_id ?? '—'}
              </p>
              <p className="text-sm text-muted-foreground">
                {t('pinsImported', { count: status.data.pin_count })}
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Button asChild>
                <Link href="/dashboard/pins">{t('viewPins')}</Link>
              </Button>
              <Button
                variant="outline"
                onClick={async () => {
                  if (!(await confirm({ title: t('disconnectConfirm'), destructive: true }))) return;
                  disconnect.mutate(undefined, {
                    onSuccess: () => toast.success(t('disconnectSuccess')),
                  });
                }}
                disabled={disconnect.isPending}
              >
                {t('disconnect')}
              </Button>
            </div>
          </div>

          <div className="space-y-4">
            <div className="space-y-1">
              <h2 className="text-lg font-bold">{t('boardsTitle')}</h2>
              <p className="text-sm text-muted-foreground">{t('boardsHint')}</p>
            </div>
            {boardsQuery.isLoading && (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} /> {t('loadingBoards')}
              </div>
            )}
            {boardsQuery.isError && (
              <EmptyState state="sad" size="sm" title={t('boardsError')} />
            )}
            {boardsQuery.data && boards.length === 0 && (
              <EmptyState state="sleepy" size="sm" title={t('noBoards')} />
            )}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {boards.map((board) => (
                <BoardCard key={board.id} board={board} />
              ))}
            </div>
            {boardsQuery.hasNextPage && (
              <div className="flex justify-center pt-2">
                <Button
                  variant="outline"
                  onClick={() => boardsQuery.fetchNextPage()}
                  disabled={boardsQuery.isFetchingNextPage}
                >
                  {boardsQuery.isFetchingNextPage ? (
                    <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} />
                  ) : null}
                  {t('loadMore')}
                </Button>
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  );
}

/** One board: cover, and whether Stinky sees it (and what he read from it). */
function BoardCard({ board }: { board: PinterestBoard }) {
  const t = useTranslations('integrations.pinterest');
  const confirm = useConfirm();
  const importBoard = usePinterestImportBoard();
  const removeBoard = usePinterestRemoveBoard();
  const state = board.stinky;
  const reading = isReadingBoard(board) || importBoard.isPending;
  const share = () =>
    importBoard.mutate(board.id, {
      onSuccess: () => toast.success(t('importQueued')),
      onError: () => toast.error(t('importFailed')),
    });
  const remove = async () => {
    if (!(await confirm({ title: t('board.removeConfirm', { name: board.name }), destructive: true })))
      return;
    removeBoard.mutate(board.id, { onSuccess: () => toast.success(t('board.removed')) });
  };

  return (
    <article className="space-y-3">
      <div className="relative aspect-[4/3] overflow-hidden rounded-tile bg-panel">
        {board.media?.image_cover_url ? (
          <Image src={board.media.image_cover_url} alt={board.name} fill className="object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            {t('noCover')}
          </div>
        )}
        {board.privacy === 'SECRET' && (
          <span className="absolute left-2 top-2 flex items-center gap-1 rounded-full bg-background/90 px-2.5 py-1 text-xs font-bold">
            <Lock className="h-3 w-3" strokeWidth={2.25} aria-hidden />
            {t('board.secret')}
          </span>
        )}
      </div>
      <div className="space-y-3 px-1">
        <div>
          <h3 className="text-[15px] font-bold leading-tight">{board.name}</h3>
          {typeof board.pin_count === 'number' && (
            <p className="eyebrow mt-0.5">{t('pinCount', { count: board.pin_count })}</p>
          )}
        </div>

        {reading ? (
          <p className="flex items-center gap-2 text-sm font-semibold text-muted-foreground" aria-live="polite">
            <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} aria-hidden />
            {t('board.reading')}
          </p>
        ) : state ? (
          <>
            {state.status === 'ready' && state.is_fashion && state.summary ? (
              <div className="rounded-2xl bg-signature-soft px-3.5 py-3 text-sm leading-snug text-foreground">
                <p className="mb-1 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-muted-foreground">
                  <Sparkles className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
                  {t('board.sees')}
                </p>
                {state.summary}
              </div>
            ) : (
              <p className="text-sm leading-snug text-muted-foreground">
                {state.status === 'no_ai'
                  ? t('board.noAi')
                  : state.status === 'error'
                    ? t('board.error')
                    : t('board.notFashion')}
              </p>
            )}
            <div className="flex gap-2">
              <Button variant="secondary" className="flex-1" onClick={share}>
                {state.status === 'error' ? t('board.retry') : t('board.refresh')}
              </Button>
              <Button variant="outline" className="flex-1" onClick={remove} disabled={removeBoard.isPending}>
                {t('board.remove')}
              </Button>
            </div>
          </>
        ) : (
          <Button variant="secondary" className="w-full" onClick={share}>
            {t('board.share')}
          </Button>
        )}
      </div>
    </article>
  );
}
