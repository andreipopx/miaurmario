'use client';

import { useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Copy, Link2, Plus } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { PillGroup, SectionCard, useAdminErrorMessage } from '@/components/admin/shared';
import type { Invite, SignupMode } from '@/lib/admin';
import { useCreateInvite, useInvites, useRevokeInvite, useSetSignupMode, useSignupMode } from '@/lib/hooks/use-admin';

const STATUS_VARIANT: Record<Invite['status'], 'mint' | 'outline' | 'secondary' | 'amber'> = {
  active: 'mint',
  revoked: 'outline',
  expired: 'secondary',
  used_up: 'amber',
};

async function copy(text: string, ok: string, fail: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(ok);
  } catch {
    toast.error(fail);
  }
}

function CreateInviteForm() {
  const t = useTranslations('admin.signup.create');
  const errorMessage = useAdminErrorMessage();
  const create = useCreateInvite();
  const [note, setNote] = useState('');
  const [maxUses, setMaxUses] = useState('');
  const [expires, setExpires] = useState('');
  const usesInvalid = maxUses.trim() !== '' && !/^[1-9]\d*$/.test(maxUses.trim());

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (usesInvalid) return;
    try {
      const invite = await create.mutateAsync({
        note: note.trim() || null,
        max_uses: maxUses.trim() ? Number(maxUses) : null,
        // End of the chosen day, local time.
        expires_at: expires ? new Date(`${expires}T23:59:59`).toISOString() : null,
      });
      setNote('');
      setMaxUses('');
      setExpires('');
      await copy(invite.link, t('createdCopied'), t('created'));
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="space-y-1">
        <Label htmlFor="invite-note" className="text-[13px]">{t('note')}</Label>
        <Input id="invite-note" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} placeholder={t('notePlaceholder')} className="h-11" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label htmlFor="invite-uses" className="text-[13px]">{t('maxUses')}</Label>
          <Input
            id="invite-uses"
            inputMode="numeric"
            value={maxUses}
            onChange={(e) => setMaxUses(e.target.value)}
            placeholder={t('unlimited')}
            aria-invalid={usesInvalid}
            className="h-11"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="invite-expires" className="text-[13px]">{t('expires')}</Label>
          <Input
            id="invite-expires"
            type="date"
            value={expires}
            min={new Date().toISOString().slice(0, 10)}
            onChange={(e) => setExpires(e.target.value)}
            className="h-11"
          />
        </div>
      </div>
      <Button type="submit" size="sm" variant="signature" disabled={usesInvalid || create.isPending}>
        <Plus className="h-4 w-4" aria-hidden />
        {t('submit')}
      </Button>
    </form>
  );
}

export function SignupSection() {
  const t = useTranslations('admin.signup');
  const format = useFormatter();
  const errorMessage = useAdminErrorMessage();
  const { data: mode } = useSignupMode(true);
  const setMode = useSetSignupMode();
  const { data: invites, isLoading } = useInvites(true);
  const revoke = useRevokeInvite();

  const changeMode = async (value: SignupMode) => {
    try {
      await setMode.mutateAsync(value);
      toast.success(t(value === 'open' ? 'modeOpenSaved' : 'modeInviteSaved'));
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <div className="space-y-4">
      <SectionCard title={t('modeTitle')} description={t('modeBody')}>
        {mode ? (
          <PillGroup<SignupMode>
            label={t('modeTitle')}
            value={mode.mode}
            disabled={setMode.isPending}
            onChange={changeMode}
            options={[
              { value: 'open', label: t('open') },
              { value: 'invite_only', label: t('inviteOnly') },
            ]}
          />
        ) : (
          <Skeleton className="h-11 w-60 rounded-full" />
        )}
        <p className="mt-3 text-sm text-muted-foreground">
          {mode?.mode === 'invite_only' ? t('inviteOnlyHint') : t('openHint')}
        </p>
      </SectionCard>

      <SectionCard title={t('create.title')} description={t('create.description')}>
        <CreateInviteForm />
      </SectionCard>

      <SectionCard title={t('listTitle')}>
        {isLoading ? (
          <Skeleton className="h-20 w-full rounded-quick" />
        ) : !invites?.length ? (
          <p className="text-sm text-muted-foreground">{t('empty')}</p>
        ) : (
          <ul className="space-y-2">
            {invites.map((inv) => (
              <li key={inv.id} className="rounded-quick bg-panel p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-2">
                    <code className="font-mono text-[15px] font-bold tracking-wide">{inv.code}</code>
                    <Badge variant={STATUS_VARIANT[inv.status]}>{t(`status.${inv.status}`)}</Badge>
                  </span>
                  <span className="text-sm tabular-nums text-muted-foreground">
                    {inv.max_uses != null
                      ? t('usesOf', { uses: inv.uses, max: inv.max_uses })
                      : t('uses', { uses: inv.uses })}
                  </span>
                </div>
                {inv.note && <p className="mt-1 text-sm">{inv.note}</p>}
                <p className="mt-1 text-xs text-muted-foreground">
                  {inv.expires_at
                    ? t('expiresOn', { date: format.dateTime(new Date(inv.expires_at), { dateStyle: 'medium' }) })
                    : t('noExpiry')}
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="bg-background"
                    onClick={() => copy(inv.link, t('linkCopied'), t('copyFailed'))}
                    disabled={inv.status !== 'active'}
                  >
                    <Link2 className="h-4 w-4" aria-hidden />
                    {t('copyLink')}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => copy(inv.code, t('codeCopied'), t('copyFailed'))}
                    aria-label={t('copyCode')}
                  >
                    <Copy className="h-4 w-4" aria-hidden />
                  </Button>
                  {inv.status === 'active' && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive"
                      disabled={revoke.isPending}
                      onClick={() =>
                        revoke
                          .mutateAsync(inv.id)
                          .then(() => toast.success(t('revoked')))
                          .catch((e) => toast.error(errorMessage(e)))
                      }
                    >
                      {t('revoke')}
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}
