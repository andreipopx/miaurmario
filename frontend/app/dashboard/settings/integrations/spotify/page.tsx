'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Loader2, Music } from 'lucide-react';
import { toast } from 'sonner';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
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
    <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-10 py-10 sm:py-14 space-y-10">
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
            <p className="text-sm text-muted-foreground">{t('allowlistNote')}</p>
          </CardContent>
        </Card>
      )}

      {status.data && connected && (
        <section className="space-y-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="space-y-1">
              <p className="label-editorial">{t('connectedAs')}</p>
              <p className="font-display text-2xl">
                {status.data.display_name || status.data.spotify_user_id}
              </p>
            </div>
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

          <div className="divider-hairline" />

          <div className="flex items-start justify-between gap-6">
            <div className="space-y-1">
              <Label htmlFor="spotify-mood" className="font-display text-lg">
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
              <p className="label-editorial text-gold">{t('moodEyebrow')}</p>
              <CardTitle className="flex items-center gap-2">
                <Music className="h-5 w-5 text-gold" strokeWidth={1.5} />
                {t('moodTitle')}
              </CardTitle>
              <CardDescription>{t('moodDescription')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              {mood.isLoading && (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.5} /> {t('moodLoading')}
                </div>
              )}
              {mood.isError && (
                <p className="font-editorial italic text-muted-foreground">{t('moodError')}</p>
              )}
              {mood.data && (
                <>
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="label-editorial">{t('currentSource')}</span>
                    <Badge>
                      {mood.data.source === 'spotify' ? t('source.spotify') : t('source.manual')}
                    </Badge>
                  </div>

                  {mood.data.context ? (
                    <div className="space-y-4">
                      {mood.data.context.track && mood.data.context.listening && (
                        <div>
                          <p className="label-editorial">
                            {t(`listening.${mood.data.context.listening}`)}
                          </p>
                          <p className="font-editorial italic text-2xl">
                            {mood.data.context.label}
                          </p>
                        </div>
                      )}
                      {mood.data.context.genres.length > 0 && (
                        <div className="space-y-2">
                          <p className="label-editorial">{t('genres')}</p>
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
                          <p className="label-editorial">{t('tags')}</p>
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
                          <span className="label-editorial mr-2">{t('topArtists')}</span>
                          {mood.data.context.top_artists.join(' · ')}
                        </p>
                      )}
                    </div>
                  ) : (
                    <p className="font-editorial italic text-muted-foreground">
                      {t(`reason.${mood.data.reason ?? 'no_data'}`)}
                    </p>
                  )}

                  <div className="divider-hairline" />
                  <p className="text-sm text-muted-foreground">
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
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" strokeWidth={1.5} />
                    ) : null}
                    {t('refresh')}
                  </Button>
                </>
              )}
            </CardContent>
          </Card>
        </section>
      )}
    </div>
  );
}
