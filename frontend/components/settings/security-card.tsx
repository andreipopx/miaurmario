'use client';

import { useState } from 'react';
import { KeyRound, Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { PasswordInput } from '@/components/auth/password-input';
import { useFormatDate } from '@/lib/date-locale';
import { PasswordRequestError, useSetPassword, useRemovePassword } from '@/lib/hooks/use-password';
import type { UserProfile } from '@/lib/hooks/use-user';

const KNOWN_ERRORS = [
  'current_password_required',
  'current_password_invalid',
  'password_too_short',
  'password_too_long',
  'password_too_common',
  'password_matches_identity',
] as const;
type KnownError = (typeof KNOWN_ERRORS)[number];

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;

/** Map a failed PUT /users/me/password to a messages key under settings.security.errors. */
export function passwordErrorKey(error: unknown): KnownError | 'rateLimited' | 'generic' {
  if (error instanceof PasswordRequestError) {
    if (error.status === 429) return 'rateLimited';
    if ((KNOWN_ERRORS as readonly string[]).includes(error.message)) {
      return error.message as KnownError;
    }
  }
  return 'generic';
}

/** Client-side pre-check mirroring the backend length rules (backend stays authoritative). */
export function localPasswordError(
  next: string,
  confirm: string,
): 'password_too_short' | 'password_too_long' | 'mismatch' | null {
  if (next.length < PASSWORD_MIN_LENGTH) return 'password_too_short';
  if (next.length > PASSWORD_MAX_LENGTH) return 'password_too_long';
  if (next !== confirm) return 'mismatch';
  return null;
}

/**
 * Settings → Seguridad: optional password on top of the magic link.
 * Set (no current password needed), change (current required) or remove.
 */
export function SecurityCard({ user }: { user: UserProfile | undefined }) {
  const t = useTranslations('settings.security');
  const formatDate = useFormatDate();
  const setPassword = useSetPassword();
  const removePassword = useRemovePassword();

  const hasPassword = !!user?.has_password;
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setCurrent('');
    setNext('');
    setConfirm('');
    setVisible(false);
    setError(null);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const local = localPasswordError(next, confirm);
    if (local) {
      setError(t(`errors.${local}`));
      return;
    }
    setError(null);
    try {
      await setPassword.mutateAsync({
        new_password: next,
        ...(hasPassword ? { current_password: current } : {}),
      });
      reset();
      toast.success(t('saved'));
    } catch (err) {
      setError(t(`errors.${passwordErrorKey(err)}`));
    }
  };

  const remove = async () => {
    try {
      await removePassword.mutateAsync();
      reset();
      toast.success(t('removed'));
    } catch (err) {
      toast.error(t(`errors.${passwordErrorKey(err)}`));
    }
  };

  const updatedAt = user?.password_updated_at ? new Date(user.password_updated_at) : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRound className="h-5 w-5" strokeWidth={1.75} aria-hidden />
          {t('title')}
        </CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-1 text-sm">
          <p className="text-foreground">{hasPassword ? t('statusSet') : t('statusNone')}</p>
          {hasPassword && updatedAt && (
            <p className="text-muted-foreground">
              {t('lastChanged', { date: formatDate(updatedAt, 'long') })}
            </p>
          )}
          <p className="text-muted-foreground">{t('magicLinkNote')}</p>
        </div>

        <form onSubmit={submit} className="space-y-4" method="post">
          <p className="font-medium">{hasPassword ? t('changeTitle') : t('setTitle')}</p>
          {/* Lets password managers attach the saved password to this account. */}
          <input
            type="text"
            name="username"
            autoComplete="username"
            value={user?.username || user?.email || ''}
            readOnly
            hidden
          />
          {hasPassword && (
            <div className="space-y-2">
              <Label htmlFor="sec-current">{t('currentLabel')}</Label>
              <PasswordInput
                id="sec-current"
                name="current-password"
                autoComplete="current-password"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
                required
                maxLength={PASSWORD_MAX_LENGTH}
                visible={visible}
                onVisibleChange={setVisible}
                showLabel={t('show')}
                hideLabel={t('hide')}
              />
            </div>
          )}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="sec-new">{t('newLabel')}</Label>
              <PasswordInput
                id="sec-new"
                name="new-password"
                autoComplete="new-password"
                value={next}
                onChange={(e) => setNext(e.target.value)}
                required
                minLength={PASSWORD_MIN_LENGTH}
                maxLength={PASSWORD_MAX_LENGTH}
                visible={visible}
                onVisibleChange={setVisible}
                showLabel={t('show')}
                hideLabel={t('hide')}
                hideToggle={hasPassword}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="sec-confirm">{t('confirmLabel')}</Label>
              <PasswordInput
                id="sec-confirm"
                name="confirm-password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
                maxLength={PASSWORD_MAX_LENGTH}
                visible={visible}
                onVisibleChange={setVisible}
                showLabel={t('show')}
                hideLabel={t('hide')}
                hideToggle
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">{t('requirements')}</p>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={setPassword.isPending} className="gap-2">
              {setPassword.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {t('save')}
            </Button>
            {hasPassword && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button type="button" variant="outline" disabled={removePassword.isPending}>
                    {t('remove')}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>{t('removeConfirmTitle')}</AlertDialogTitle>
                    <AlertDialogDescription>{t('removeConfirmBody')}</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
                    <AlertDialogAction onClick={remove}>{t('removeConfirm')}</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </div>
          {hasPassword && <p className="text-xs text-muted-foreground">{t('forgotHint')}</p>}
        </form>
      </CardContent>
    </Card>
  );
}
