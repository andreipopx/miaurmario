'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { ExternalLink, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { PageHeader } from '@/components/page-header';
import { DisconnectMusicDialog } from '@/components/music/disconnect-music-dialog';
import { MusicPrefsCard } from '@/components/music/music-prefs-card';
import {
  LASTFM_USERNAME_RE,
  lastfmErrorCode,
  normaliseLastfmUsername,
  useLastfmConnect,
  useLastfmDisconnect,
  useLastfmStatus,
  useLastfmUpdateSettings,
  useLastfmWebAuth,
} from '@/lib/hooks/use-lastfm';
import { useSpotifyStatus } from '@/lib/hooks/use-spotify';
import { relativeTime } from '@/lib/music';

const PAGE = '/dashboard/settings/integrations/lastfm';
const CONNECT_ERRORS = [
  'lastfm_user_not_found',
  'lastfm_private',
  'lastfm_rate_limited',
  'lastfm_unavailable',
  'lastfm_not_configured',
] as const;
const CALLBACK_ERRORS = ['invalid_state', 'access_denied', 'session_failed'] as const;
const SYNC_ERRORS = ['private', 'not_found', 'rate_limited', 'bad_key', 'unavailable'] as const;

function known(list: readonly string[], value: string | null | undefined): value is string {
  return Boolean(value && list.includes(value));
}

export default function LastfmIntegrationPage() {
  const t = useTranslations('integrations.lastfm');
  const tI = useTranslations('integrations');
  const tMusic = useTranslations('music');
  const locale = useLocale();
  const params = useSearchParams();
  const router = useRouter();
  const justConnected = params.get('connected') === '1';
  const errorParam = params.get('error');

  const status = useLastfmStatus();
  const spotify = useSpotifyStatus();
  const connect = useLastfmConnect();
  const webAuth = useLastfmWebAuth();
  const disconnect = useLastfmDisconnect();
  const updateSettings = useLastfmUpdateSettings();

  const [username, setUsername] = useState('');
  const [invalid, setInvalid] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    if (justConnected) {
      toast.success(t('connectedToast'));
      router.replace(PAGE);
    }
  }, [justConnected, router, t]);

  const connected = status.data?.connected ?? false;
  const connectCode = lastfmErrorCode(connect.error);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const value = normaliseLastfmUsername(username);
    if (!LASTFM_USERNAME_RE.test(value)) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    connect.mutate(value, {
      onSuccess: () => {
        setUsername('');
        toast.success(t('connectedToast'));
      },
    });
  };

  const onDisconnect = (keepHistory: boolean) =>
    disconnect.mutate(
      { keepHistory },
      {
        onSuccess: () => {
          setConfirmOpen(false);
          toast.success(
            keepHistory
              ? t('disconnectSuccess')
              : tI('disconnectMusic.deletedToast', { source: 'Last.fm' })
          );
        },
      }
    );

  const syncError = status.data?.last_error;

  return (
    <div className="mx-auto max-w-4xl space-y-6 py-2 sm:py-4">
      <Button variant="ghost" asChild className="-ml-3 text-muted-foreground hover:text-foreground">
        <Link href="/dashboard/settings/integrations">{tI('backToIntegrations')}</Link>
      </Button>

      <PageHeader title={t('title')} description={t('tagline')} />

      {errorParam && (
        <Alert variant="destructive">
          <AlertTitle>{t('errorTitle')}</AlertTitle>
          <AlertDescription>
            {known(CALLBACK_ERRORS, errorParam) ? t(`errors.${errorParam}`) : t('errorGeneric')}
          </AlertDescription>
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
          <CardContent className="space-y-5">
            {!status.data.configured ? (
              <p className="text-sm text-muted-foreground">{t('notConfigured')}</p>
            ) : (
              <>
                <form onSubmit={submit} className="space-y-2" noValidate>
                  <Label htmlFor="lastfm-username" className="text-[15px] font-bold">
                    {t('usernameLabel')}
                  </Label>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Input
                      id="lastfm-username"
                      value={username}
                      onChange={(e) => {
                        setUsername(e.target.value);
                        setInvalid(false);
                      }}
                      placeholder={t('usernamePlaceholder')}
                      autoComplete="username"
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck={false}
                      maxLength={200}
                      aria-invalid={invalid || Boolean(connectCode)}
                      aria-describedby="lastfm-username-help"
                      className="sm:flex-1"
                    />
                    <Button type="submit" disabled={connect.isPending || !username.trim()}>
                      {connect.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                      {t('connectButton')}
                    </Button>
                  </div>
                  <p id="lastfm-username-help" className="text-xs text-muted-foreground">
                    {t('usernameHelp')}
                  </p>
                  {(invalid || connect.isError) && (
                    <p role="alert" className="text-sm font-medium text-destructive">
                      {invalid
                        ? t('usernameInvalid')
                        : known(CONNECT_ERRORS, connectCode)
                          ? t(`errors.${connectCode}`)
                          : t('errorGeneric')}
                    </p>
                  )}
                </form>

                {status.data.auth_available && (
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-muted-foreground">{t('or')}</span>
                    <Button
                      variant="secondary"
                      onClick={() => webAuth.mutate()}
                      disabled={webAuth.isPending}
                    >
                      {webAuth.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                      {t('webAuthButton')}
                    </Button>
                  </div>
                )}
              </>
            )}

            <div className="space-y-1 rounded-quick bg-panel p-4">
              <p className="text-sm font-bold">{t('howTitle')}</p>
              <p className="text-sm text-muted-foreground">{t('howBody')}</p>
              <a
                href="https://www.last.fm/settings/applications"
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-1 text-sm font-bold underline-offset-4 hover:underline"
              >
                {t('howLink')}
                <ExternalLink className="h-3.5 w-3.5" aria-hidden />
              </a>
            </div>
          </CardContent>
        </Card>
      )}

      {status.data && connected && (
        <section className="space-y-6">
          <div className="flex flex-col gap-4 rounded-lg bg-panel p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
            <div className="min-w-0 space-y-1">
              <p className="eyebrow">{t('connectedAs')}</p>
              <p className="truncate text-xl font-extrabold tracking-tight">{status.data.username}</p>
              <p className="text-sm text-muted-foreground">
                {status.data.last_sync_at
                  ? t('lastSync', {
                      when: relativeTime(status.data.last_sync_at, locale, tMusic('justNow')),
                    })
                  : t('neverSynced')}
              </p>
              {status.data.profile_url && (
                <a
                  href={status.data.profile_url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-flex items-center gap-1 text-sm font-bold underline-offset-4 hover:underline"
                >
                  {t('openProfile')}
                  <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                </a>
              )}
            </div>
            <Button variant="outline" onClick={() => setConfirmOpen(true)} disabled={disconnect.isPending}>
              {t('disconnect')}
            </Button>
          </div>

          {syncError && (
            <Alert variant="destructive">
              <AlertDescription>
                {t(`syncErrors.${known(SYNC_ERRORS, syncError) ? syncError : 'unavailable'}`)}
              </AlertDescription>
            </Alert>
          )}

          {spotify.data?.connected && (
            <p className="px-1 text-sm text-muted-foreground">{t('bothNote')}</p>
          )}

          <div className="flex items-start justify-between gap-6 px-1">
            <div className="space-y-1">
              <Label htmlFor="lastfm-mood" className="text-[15px] font-bold">
                {t('useForMood')}
              </Label>
              <p className="text-sm text-muted-foreground">{t('useForMoodHelp')}</p>
            </div>
            <Switch
              id="lastfm-mood"
              checked={status.data.use_for_mood}
              disabled={updateSettings.isPending}
              onCheckedChange={(checked) =>
                updateSettings.mutate(checked, { onError: () => toast.error(t('settingsFailed')) })
              }
            />
          </div>

          <MusicPrefsCard />
        </section>
      )}

      <DisconnectMusicDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        source="Last.fm"
        pending={disconnect.isPending}
        onConfirm={onDisconnect}
      />
    </div>
  );
}
