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
    <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-10 py-10 sm:py-14 space-y-10">
      <header className="space-y-3">
        <Link href="/dashboard/settings/integrations" className="label-editorial link-editorial">
          {tI('backToIntegrations')}
        </Link>
        <p className="label-editorial text-gold">{t('eyebrow')}</p>
        <h1 className="font-display italic font-black text-display-lg leading-none">
          {t('title')}
        </h1>
        <p className="font-editorial italic text-lg text-muted-foreground">{t('tagline')}</p>
      </header>

      <div className="divider-gold" />

      {errorParam && (
        <Alert variant="destructive">
          <AlertTitle>{t('errorTitle')}</AlertTitle>
          <AlertDescription>{t(errorKey)}</AlertDescription>
        </Alert>
      )}

      {status.isLoading && (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.5} /> {tI('loading')}
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
              <p className="font-editorial italic text-muted-foreground">{t('notConfigured')}</p>
            ) : (
              <Button onClick={() => connect.mutate()} disabled={connect.isPending}>
                {connect.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" strokeWidth={1.5} />
                ) : null}
                {t('connectButton')}
              </Button>
            )}
            <p className="label-editorial">{t('scopesNote')}</p>
          </CardContent>
        </Card>
      )}

      {status.data && connected && (
        <section className="space-y-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="space-y-1">
              <p className="label-editorial">{t('connectedAs')}</p>
              <p className="font-display text-2xl">
                {status.data.pinterest_user_id ?? '—'}
              </p>
              <p className="font-editorial italic text-muted-foreground">
                {t('pinsImported', { count: status.data.pin_count })}
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Button variant="outline" asChild>
                <Link href="/dashboard/pins">{t('viewPins')}</Link>
              </Button>
              <Button
                variant="ghost"
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

          <div className="divider-hairline" />

          <div className="space-y-4">
            <h2 className="font-display text-2xl">{t('boardsTitle')}</h2>
            {boardsQuery.isLoading && (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.5} /> {t('loadingBoards')}
              </div>
            )}
            {boardsQuery.isError && (
              <p className="font-editorial italic text-muted-foreground">{t('boardsError')}</p>
            )}
            {boardsQuery.data && boards.length === 0 && (
              <p className="font-editorial italic text-muted-foreground">{t('noBoards')}</p>
            )}
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {boards.map((board) => (
                <article
                  key={board.id}
                  className="card-editorial border border-border-solid/60 bg-card"
                >
                  <div className="img-zoom relative aspect-[4/3] bg-muted">
                    {board.media?.image_cover_url ? (
                      <Image
                        src={board.media.image_cover_url}
                        alt={board.name}
                        fill
                        className="object-cover"
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center font-editorial italic text-muted-foreground">
                        {t('noCover')}
                      </div>
                    )}
                  </div>
                  <div className="space-y-3 p-4">
                    <div>
                      <h3 className="font-display text-lg leading-tight">{board.name}</h3>
                      {typeof board.pin_count === 'number' && (
                        <p className="label-editorial mt-1">
                          {t('pinCount', { count: board.pin_count })}
                        </p>
                      )}
                    </div>
                    <Button
                      variant="outline"
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
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" strokeWidth={1.5} />
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
                  variant="secondary"
                  onClick={() => boardsQuery.fetchNextPage()}
                  disabled={boardsQuery.isFetchingNextPage}
                >
                  {boardsQuery.isFetchingNextPage ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" strokeWidth={1.5} />
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
