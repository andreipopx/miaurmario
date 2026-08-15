'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useRequestFriend } from '@/lib/hooks/use-social';
import { getErrorMessage } from '@/lib/api';

const USERNAME_RE = /^[a-z0-9_]{3,20}$/;

export function FriendRequestButton() {
  const t = useTranslations('friends');
  const [username, setUsername] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const { mutateAsync, isPending } = useRequestFriend();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSent(null);
    const value = username.trim().toLowerCase();
    if (!USERNAME_RE.test(value)) {
      setError(t('errors.invalidFormat'));
      return;
    }
    try {
      await mutateAsync(value);
      setSent(value);
      setUsername('');
    } catch (err) {
      setError(getErrorMessage(err, t('errors.generic')));
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <Input
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        placeholder={t('search.placeholder')}
        aria-label={t('search.label')}
        className="sm:flex-1"
        autoCapitalize="none"
        autoCorrect="off"
      />
      <Button type="submit" disabled={isPending}>
        {isPending ? t('search.sending') : t('search.send')}
      </Button>
      {error && <p className="label-editorial text-destructive">{error}</p>}
      {sent && <p className="label-editorial text-muted-foreground">{t('search.sentTo', { username: sent })}</p>}
    </form>
  );
}
