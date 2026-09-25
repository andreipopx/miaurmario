'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Loader2, Music } from 'lucide-react';
import { toast } from 'sonner';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/page-header';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { DisconnectMusicDialog } from '@/components/music/disconnect-music-dialog';
import { MusicPrefsCard } from '@/components/music/music-prefs-card';
import { SpotifySeatRequest } from '@/components/music/spotify-seat-request';
import {
  useSpotifyConnect,
  useSpotifyDisconnect,
  useSpotifyMood,
  useSpotifyMoodRefresh,
  useSpotifyStatus,
  useSpotifyUpdateSettings,
} from '@/lib/hooks/use-spotify';

const KNOWN_ERRORS = [
  'invalid_state',
  'access_denied',
  'exchange_failed',
  'not_allowlisted',
  'profile_failed',
] as const;

export default function SpotifyIntegrationPage() {
  const t = useTranslations('integrations.spotify');
  const tI = useTranslations('integrations');
  const params = useSearchParams();
  const router = useRouter();
  const justConnected = params.get('connected') === '1';
  const errorParam = params.get('error');

  const status = useSpotifyStatus();
  const connected = status.data?.connected ?? false;
  const mood = useSpotifyMood(connected);
  const connect = useSpotifyConnect();
  const disconnect = useSpotifyDisconnect();
  const updateSettings = useSpotifyUpdateSettings();
  const refreshMood = useSpotifyMoodRefresh();
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    if (justConnected) {
      toast.success(t('connectedToast'));
      router.replace('/dashboard/settings/integrations/spotify');
    }
  }, [justConnected, router, t]);

  const errorKey =
    errorParam && (KNOWN_ERRORS as readonly string[]).includes(errorParam)
      ? `errors.${errorParam}`
      : 'errorGeneric';

  const fallbackLabel = status.data?.lastfm_configured ? t('source.lastfm') : t('source.musicbrainz');

  return (
    <div className="mx-auto max-w-4xl space-y-6 py-2 sm:py-4">
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
            <p className="text-sm text-muted-foreground">{t('allowlistNote')}</p>
            {/* Development Mode: the only way in is Andrei adding the account by hand.
                Opens itself when Spotify has just rejected an account. */}
            {status.data.configured && (
              <SpotifySeatRequest defaultOpen={errorParam === 'not_allowlisted'} />
            )}
          </CardContent>
        </Card>
      )}

      {status.data && connected && (
        <section className="space-y-6">
          <div className="flex flex-col gap-4 rounded-lg bg-panel p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
            <div className="space-y-1">
              <p className="eyebrow">{t('connectedAs')}</p>
              <p className="text-xl font-extrabold tracking-tight">
                {status.data.display_name || status.data.spotify_user_id}
              </p>
            </div>
            <Button
              variant="outline"
              onClick={() => setConfirmOpen(true)}
              disabled={disconnect.isPending}
            >
              {t('disconnect')}
            </Button>
          </div>

          <div className="flex items-start justify-between gap-6 px-1">
            <div className="space-y-1">
              <Label htmlFor="spotify-mood" className="text-[15px] font-bold">
                {t('useForMood')}
              </Label>
              <p className="text-sm text-muted-foreground">{t('useForMoodHelp')}</p>
            </div>
            <Switch
              id="spotify-mood"
              checked={status.data.use_for_mood}
              disabled={updateSettings.isPending}
              onCheckedChange={(checked) =>
                updateSettings.mutate(checked, {
                  onError: () => toast.error(t('settingsFailed')),
                })
              }
            />
          </div>

          <Card>
            <CardHeader>
              <p className="eyebrow">{t('moodEyebrow')}</p>
              <CardTitle className="flex items-center gap-2">
                <span aria-hidden className="flex h-9 w-9 items-center justify-center rounded-full bg-pop-mint text-pop-foreground">
                  <Music className="h-4 w-4" strokeWidth={1.75} />
                </span>
                {t('moodTitle')}
              </CardTitle>
              <CardDescription>{t('moodDescription')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              {mood.isLoading && (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} /> {t('moodLoading')}
                </div>
              )}
              {mood.isError && (
                <p className="text-sm font-medium text-destructive">{t('moodError')}</p>
              )}
              {mood.data && (
                <>
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="eyebrow">{t('currentSource')}</span>
                    <Badge variant="signature">
                      {mood.data.source === 'spotify' ? t('source.spotify') : t('source.manual')}
                    </Badge>
                  </div>

                  {mood.data.context ? (
                    <div className="space-y-4">
                      {mood.data.context.track && mood.data.context.listening && (
                        <div>
                          <p className="eyebrow">
                            {t(`listening.${mood.data.context.listening}`)}
                          </p>
                          <p className="text-xl font-extrabold tracking-tight">
                            {mood.data.context.label}
                          </p>
                        </div>
                      )}
                      {mood.data.context.genres.length > 0 && (
                        <div className="space-y-2">
                          <p className="eyebrow">{t('genres')}</p>
                          <div className="flex flex-wrap gap-2">
                            {mood.data.context.genres.map((g) => (
                              <Badge key={g} variant="outline">
                                {g}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      )}
                      {mood.data.context.tags.length > 0 && (
                        <div className="space-y-2">
                          <p className="eyebrow">{t('tags')}</p>
                          <div className="flex flex-wrap gap-2">
                            {mood.data.context.tags.map((tag) => (
                              <Badge key={tag} variant="outline">
                                {tag}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      )}
                      {mood.data.context.top_artists.length > 0 && (
                        <p className="text-sm text-muted-foreground">
                          <span className="mr-2 font-semibold text-foreground">{t('topArtists')}</span>
                          {mood.data.context.top_artists.join(' · ')}
                        </p>
                      )}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      {t(`reason.${mood.data.reason ?? 'no_data'}`)}
                    </p>
                  )}

                  <p className="border-t border-border pt-4 text-sm text-muted-foreground">
                    {t('fallbackNote', { fallback: fallbackLabel })}
                  </p>
                  <Button
                    variant="secondary"
                    onClick={() =>
                      refreshMood.mutate(undefined, {
                        onError: () => toast.error(t('moodError')),
                      })
                    }
                    disabled={refreshMood.isPending}
                  >
                    {refreshMood.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} />
                    ) : null}
                    {t('refresh')}
                  </Button>
                </>
              )}
            </CardContent>
          </Card>

          <MusicPrefsCard />
        </section>
      )}

      <DisconnectMusicDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        source="Spotify"
        pending={disconnect.isPending}
        onConfirm={(keepHistory) =>
          disconnect.mutate(
            { keepHistory },
            {
              onSuccess: () => {
                setConfirmOpen(false);
                toast.success(
                  keepHistory
                    ? t('disconnectSuccess')
                    : tI('disconnectMusic.deletedToast', { source: 'Spotify' })
                );
              },
            }
          )
        }
      />
    </div>
  );
}
