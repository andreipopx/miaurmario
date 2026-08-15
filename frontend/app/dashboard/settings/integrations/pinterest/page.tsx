'use client';

import Image from 'next/image';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  usePinterestBoards,
  usePinterestConnect,
  usePinterestDisconnect,
  usePinterestImportBoard,
} from '@/lib/hooks/use-pinterest';

export default function PinterestIntegrationPage() {
  const t = useTranslations('integrations.pinterest');
  const params = useSearchParams();
  const connected = params.get('connected') === '1';
  const errorParam = params.get('error');

  const boardsQuery = usePinterestBoards(connected);
  const connect = usePinterestConnect();
  const disconnect = usePinterestDisconnect();
  const importBoard = usePinterestImportBoard();

  const notConnected = boardsQuery.isError || (!connected && !boardsQuery.data);

  return (
    <div className="mx-auto max-w-4xl space-y-6 py-8">
      <div>
        <h1 className="font-serif text-3xl">{t('title')}</h1>
        <p className="mt-1 text-muted-foreground">{t('description')}</p>
      </div>

      {errorParam && (
        <Card>
          <CardContent className="pt-6 text-destructive">{t('errorGeneric')}</CardContent>
        </Card>
      )}

      {notConnected && (
        <Card>
          <CardHeader>
            <CardTitle>{t('connectTitle')}</CardTitle>
            <CardDescription>{t('connectDescription')}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              onClick={() => connect.mutate()}
              disabled={connect.isPending}
            >
              {connect.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {t('connectButton')}
            </Button>
          </CardContent>
        </Card>
      )}

      {!notConnected && boardsQuery.isLoading && (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> {t('loadingBoards')}
        </div>
      )}

      {!notConnected && boardsQuery.data && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-serif text-xl">{t('boardsTitle')}</h2>
            <Button
              variant="ghost"
              onClick={() =>
                disconnect.mutate(undefined, {
                  onSuccess: () => toast.success(t('disconnectSuccess')),
                })
              }
              disabled={disconnect.isPending}
            >
              {t('disconnect')}
            </Button>
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {boardsQuery.data.items.map((board) => (
              <Card key={board.id}>
                <CardHeader>
                  <CardTitle className="text-base">{board.name}</CardTitle>
                  {typeof board.pin_count === 'number' && (
                    <CardDescription>{t('pinCount', { count: board.pin_count })}</CardDescription>
                  )}
                </CardHeader>
                <CardContent className="space-y-3">
                  {board.media?.image_cover_url && (
                    <div className="relative aspect-video overflow-hidden rounded">
                      <Image
                        src={board.media.image_cover_url}
                        alt={board.name}
                        fill
                        className="object-cover"
                      />
                    </div>
                  )}
                  <Button
                    className="w-full"
                    onClick={() =>
                      importBoard.mutate(board.id, {
                        onSuccess: () => toast.success(t('importQueued')),
                        onError: () => toast.error(t('importFailed')),
                      })
                    }
                    disabled={importBoard.isPending}
                  >
                    {importBoard.isPending && importBoard.variables === board.id ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : null}
                    {t('importBoard')}
                  </Button>
                </CardContent>
              </Card>
            ))}
            {boardsQuery.data.items.length === 0 && (
              <p className="text-muted-foreground">{t('noBoards')}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
