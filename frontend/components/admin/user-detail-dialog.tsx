'use client';

import { useEffect, useState } from 'react';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Loader2, ShieldAlert } from 'lucide-react';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { KeyValue, useAdminErrorMessage } from '@/components/admin/shared';
import {
  deletionConfirmMatches,
  deletionConfirmTarget,
  formatCompact,
  formatEur,
  parseCap,
} from '@/lib/admin';
import { useAdminUserDetail, useDeleteAccount, useRemovePassword } from '@/lib/hooks/use-admin';
import { useUpdateAdminUser } from '@/lib/hooks/use-ai-access';

function DeleteAccountDialog({
  open,
  onOpenChange,
  user,
  onDeleted,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: { id: string; username: string | null; email: string; display_name: string };
  onDeleted: () => void;
}) {
  const t = useTranslations('admin.users.delete');
  const errorMessage = useAdminErrorMessage();
  const del = useDeleteAccount();
  const [typed, setTyped] = useState('');
  const target = deletionConfirmTarget(user);
  const matches = deletionConfirmMatches(user, typed);

  useEffect(() => {
    if (!open) setTyped('');
  }, [open]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!matches) return;
    try {
      await del.mutateAsync({ id: user.id, confirm: typed });
      toast.success(t('queued'));
      onOpenChange(false);
      onDeleted();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{t('title', { name: user.display_name })}</DialogTitle>
            <DialogDescription>{t('body')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="confirm-delete" className="text-sm">
              {t.rich('typeToConfirm', {
                target: () => <code className="rounded-sm bg-panel px-1.5 py-0.5 font-mono text-[13px]">{target}</code>,
              })}
            </Label>
            <Input
              id="confirm-delete"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
            />
          </div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              {t('cancel')}
            </Button>
            <Button type="submit" variant="destructive" disabled={!matches || del.isPending}>
              {del.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              {t('confirm')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function UserDetailDialog({
  userId,
  onClose,
}: {
  userId: string | null;
  onClose: () => void;
}) {
  const t = useTranslations('admin');
  const tu = useTranslations('admin.users');
  const format = useFormatter();
  const locale = useLocale();
  const errorMessage = useAdminErrorMessage();
  const { data: user, isLoading } = useAdminUserDetail(userId);
  const update = useUpdateAdminUser();
  const removePassword = useRemovePassword();
  const [cap, setCap] = useState('');
  const [confirmPassword, setConfirmPassword] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    setCap(user?.monthly_request_cap?.toString() ?? '');
  }, [user?.monthly_request_cap, user?.id]);

  const run = async (data: Parameters<typeof update.mutateAsync>[0]['data']) => {
    if (!user) return;
    try {
      await update.mutateAsync({ id: user.id, data });
      toast.success(t('saved'));
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const date = (value: string | null) =>
    value ? format.dateTime(new Date(value), { dateStyle: 'medium' }) : t('never');
  const capValue = parseCap(cap);
  const capChanged = user && capValue !== 'invalid' && capValue !== user.monthly_request_cap;
  const yesNo = (v: boolean) => (v ? tu('yes') : tu('no'));
  const pendingDeletion = user?.deletion_status && user.deletion_status !== 'failed';

  return (
    <Dialog open={Boolean(userId)} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl">
        {isLoading || !user ? (
          <div className="space-y-3" aria-busy="true">
            <Skeleton className="h-7 w-48 rounded-full" />
            <Skeleton className="h-32 w-full rounded-lg" />
          </div>
        ) : (
          <div className="space-y-5">
            <DialogHeader className="pr-10 text-left">
              <DialogTitle className="break-words">{user.display_name}</DialogTitle>
              <DialogDescription className="break-all">
                {user.username ? `@${user.username} · ` : ''}
                {user.email}
              </DialogDescription>
              <div className="flex flex-wrap gap-1 pt-1">
                {user.is_admin && <Badge>{t('badges.admin')}</Badge>}
                {!user.is_active && <Badge variant="outline">{t('badges.inactive')}</Badge>}
                {pendingDeletion && <Badge variant="destructive">{tu('deletionPending')}</Badge>}
              </div>
            </DialogHeader>

            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
              <KeyValue label={t('fields.created')}>{date(user.created_at)}</KeyValue>
              <KeyValue label={t('fields.lastLogin')}>{date(user.last_login_at)}</KeyValue>
              <KeyValue label={tu('onboarding')}>{yesNo(user.onboarding_completed)}</KeyValue>
              <KeyValue label={tu('password')}>{yesNo(user.has_password)}</KeyValue>
              <KeyValue label={t('fields.items')}>{user.item_count}</KeyValue>
              <KeyValue label={tu('outfits')}>{user.outfit_count}</KeyValue>
              <KeyValue label={tu('friends')}>{user.friend_count ?? '—'}</KeyValue>
              <KeyValue label={tu('integrations')}>
                {[user.spotify_connected && 'Spotify', user.pinterest_connected && 'Pinterest']
                  .filter(Boolean)
                  .join(' · ') || tu('none')}
              </KeyValue>
            </dl>

            <p className="flex items-start gap-2 rounded-quick bg-panel p-3 text-[13px] text-muted-foreground">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden />
              {tu('privacy')}
            </p>

            <section className="space-y-3 border-t border-border pt-4">
              <h3 className="text-[15px] font-bold">{tu('aiTitle')}</h3>
              <p className="text-sm text-muted-foreground">
                {tu('aiUsage', {
                  requests: user.requests_this_month,
                  tokensIn: formatCompact(user.input_tokens_this_month, locale),
                  tokensOut: formatCompact(user.output_tokens_this_month, locale),
                  cost: formatEur(user.cost_eur_this_month, locale),
                })}
              </p>
              <div className="flex items-center gap-3">
                <Switch
                  id="detail-grant"
                  checked={user.effective_ai_access === 'platform'}
                  disabled={user.is_admin || update.isPending}
                  onCheckedChange={(checked) => run({ ai_access: checked ? 'platform' : 'none' })}
                />
                <Label htmlFor="detail-grant" className="text-sm">
                  {user.is_admin ? t('grantAdmin') : user.ai_access === 'byok' ? t('grantByok') : t('grant')}
                </Label>
              </div>
              <div className="flex items-end gap-2">
                <div className="flex-1 space-y-1">
                  <Label htmlFor="detail-cap" className="text-xs text-muted-foreground">
                    {t('fields.cap')}
                  </Label>
                  <Input
                    id="detail-cap"
                    inputMode="numeric"
                    value={cap}
                    onChange={(e) => setCap(e.target.value)}
                    placeholder={t('capPlaceholder')}
                    className="h-11"
                    aria-invalid={capValue === 'invalid'}
                  />
                </div>
                <Button
                  variant="secondary"
                  disabled={!capChanged || update.isPending}
                  onClick={() => capValue !== 'invalid' && run({ monthly_request_cap: capValue })}
                >
                  {t('saveCap')}
                </Button>
              </div>
            </section>

            {!user.is_admin && (
              <section className="space-y-3 border-t border-border pt-4">
                <h3 className="text-[15px] font-bold">{tu('accountTitle')}</h3>
                <div className="flex items-center gap-3">
                  <Switch
                    id="detail-active"
                    checked={user.is_active}
                    disabled={update.isPending || Boolean(pendingDeletion)}
                    onCheckedChange={(checked) => run({ is_active: checked })}
                  />
                  <Label htmlFor="detail-active" className="text-sm">
                    {t('active')}
                  </Label>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!user.has_password || removePassword.isPending}
                    onClick={() => setConfirmPassword(true)}
                  >
                    {tu('removePassword')}
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={Boolean(pendingDeletion)}
                    onClick={() => setDeleting(true)}
                  >
                    {tu('deleteAccount')}
                  </Button>
                </div>
              </section>
            )}

            <AlertDialog open={confirmPassword} onOpenChange={setConfirmPassword}>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{tu('removePasswordTitle')}</AlertDialogTitle>
                  <AlertDialogDescription>{tu('removePasswordBody')}</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{tu('delete.cancel')}</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={async () => {
                      try {
                        await removePassword.mutateAsync(user.id);
                        toast.success(tu('passwordRemoved'));
                      } catch (err) {
                        toast.error(errorMessage(err));
                      }
                    }}
                  >
                    {tu('removePassword')}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>

            <DeleteAccountDialog open={deleting} onOpenChange={setDeleting} user={user} onDeleted={onClose} />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
