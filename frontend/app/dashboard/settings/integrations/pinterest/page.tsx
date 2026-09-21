'use client';

import { useEffect } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/empty-state';
import {
  usePinterestBoards,
  usePinterestConnect,
  usePinterestDisconnect,
  usePinterestImportBoard,
  usePinterestStatus,
} from '@/lib/hooks/use-pinterest';

const KNOWN_ERRORS = ['invalid_state', 'access_denied', 'exchange_failed'] as const;

export default function PinterestIntegrationPage() {
  const t = useTranslations('integrations.pinterest');
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
  const importBoard = usePinterestImportBoard();

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
            {!status.data.configured ? (
              <p className="text-sm text-muted-foreground">{t('notConfigured')}</p>
            ) : (
              <Button onClick={() => connect.mutate()} disabled={connect.isPending}>
                {connect.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} />
                ) : null}
                {t('connectButton')}
              </Button>
            )}
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
                onClick={() => {
                  if (!window.confirm(t('disconnectConfirm'))) return;
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
            <h2 className="text-lg font-bold">{t('boardsTitle')}</h2>
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
                <article key={board.id} className="space-y-3">
                  <div className="relative aspect-[4/3] overflow-hidden rounded-tile bg-panel">
                    {board.media?.image_cover_url ? (
                      <Image
                        src={board.media.image_cover_url}
                        alt={board.name}
                        fill
                        className="object-cover"
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                        {t('noCover')}
                      </div>
                    )}
                  </div>
                  <div className="space-y-3 px-1">
                    <div>
                      <h3 className="text-[15px] font-bold leading-tight">{board.name}</h3>
                      {typeof board.pin_count === 'number' && (
                        <p className="eyebrow mt-0.5">
                          {t('pinCount', { count: board.pin_count })}
                        </p>
                      )}
                    </div>
                    <Button
                      variant="secondary"
                      className="w-full"
                      onClick={() =>
                        importBoard.mutate(board.id, {
                          onSuccess: () => toast.success(t('importQueued')),
                          onError: () => toast.error(t('importFailed')),
                        })
                      }
                      disabled={importBoard.isPending && importBoard.variables === board.id}
                    >
                      {importBoard.isPending && importBoard.variables === board.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} />
                      ) : null}
                      {t('importBoard')}
                    </Button>
                  </div>
                </article>
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
