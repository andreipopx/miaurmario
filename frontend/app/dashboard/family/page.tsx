'use client';

import { useState } from 'react';
import { useSession } from 'next-auth/react';
import { toast } from 'sonner';
import { useLocale, useTranslations } from 'next-intl';
import {
  Loader2,
  Users,
  Copy,
  Check,
  RefreshCw,
  UserPlus,
  LogOut,
  Crown,
  Trash2,
  Mail,
  Clock,
  Shield,
  Star,
  Shirt,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  useFamily,
  useCreateFamily,
  useJoinFamily,
  useLeaveFamily,
  useRegenerateInviteCode,
  useInviteMember,
  useCancelInvite,
  useUpdateMemberRole,
  useRemoveMember,
  useUpdateFamily,
} from '@/lib/hooks/use-family';
import Link from 'next/link';
import { PageHeader } from '@/components/page-header';
import { cn } from '@/lib/utils';

function NoFamilyView() {
  const t = useTranslations('family');
  const tCommon = useTranslations('common');
  const [mode, setMode] = useState<'create' | 'join' | null>(null);
  const [familyName, setFamilyName] = useState('');
  const [inviteCode, setInviteCode] = useState('');

  const createFamily = useCreateFamily();
  const joinFamily = useJoinFamily();

  const handleCreate = async () => {
    if (!familyName.trim()) return;
    try {
      await createFamily.mutateAsync(familyName.trim());
      toast.success(t('createdToast'));
      setFamilyName('');
      setMode(null);
    } catch (error) {
      toast.error(t('createError'));
    }
  };

  const handleJoin = async () => {
    if (!inviteCode.trim()) return;
    try {
      await joinFamily.mutateAsync(inviteCode.trim().toUpperCase());
      toast.success(t('joinedToast'));
      setInviteCode('');
      setMode(null);
    } catch (error) {
      toast.error(t('invalidCode'));
    }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6 py-2 sm:py-4">
      <PageHeader title={t('title')} description={t('noFamilySubtitle')} />

      <div className="grid grid-cols-1 max-w-2xl gap-4 md:grid-cols-2">
        <Card className={cn('border-0 bg-panel', mode === 'create' && 'ring-2 ring-signature')}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <span aria-hidden className="flex h-10 w-10 items-center justify-center rounded-full bg-pop-amber text-pop-foreground">
                <Users className="h-5 w-5" strokeWidth={1.75} />
              </span>
              {t('createCardTitle')}
            </CardTitle>
            <CardDescription>{t('createCardDesc')}</CardDescription>
          </CardHeader>
          <CardContent>
            {mode === 'create' ? (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="family-name">{t('familyNameLabel')}</Label>
                  <Input
                    id="family-name"
                    placeholder={t('familyNameExample')}
                    value={familyName}
                    onChange={(e) => setFamilyName(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                    className="bg-background"
                  />
                </div>
                <div className="flex gap-2">
                  <Button
                    onClick={handleCreate}
                    disabled={!familyName.trim() || createFamily.isPending}
                  >
                    {createFamily.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                    {t('createButton')}
                  </Button>
                  <Button variant="outline" onClick={() => setMode(null)}>
                    {tCommon('cancel')}
                  </Button>
                </div>
              </div>
            ) : (
              <Button onClick={() => setMode('create')} className="w-full">
                {t('createCardTitle')}
              </Button>
            )}
          </CardContent>
        </Card>

        <Card className={cn('border-0 bg-panel', mode === 'join' && 'ring-2 ring-signature')}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <span aria-hidden className="flex h-10 w-10 items-center justify-center rounded-full bg-pop-sky text-pop-foreground">
                <UserPlus className="h-5 w-5" strokeWidth={1.75} />
              </span>
              {t('joinCardTitle')}
            </CardTitle>
            <CardDescription>{t('joinCardDesc')}</CardDescription>
          </CardHeader>
          <CardContent>
            {mode === 'join' ? (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="invite-code">{t('inviteCodeLabel')}</Label>
                  <Input
                    id="invite-code"
                    placeholder={t('inviteCodePlaceholder')}
                    value={inviteCode}
                    onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
                    onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
                    className="bg-background font-mono uppercase"
                  />
                </div>
                <div className="flex gap-2">
                  <Button
                    onClick={handleJoin}
                    disabled={!inviteCode.trim() || joinFamily.isPending}
                  >
                    {joinFamily.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                    {t('joinButton')}
                  </Button>
                  <Button variant="outline" onClick={() => setMode(null)}>
                    {tCommon('cancel')}
                  </Button>
                </div>
                {joinFamily.isError && (
                  <p className="text-sm text-destructive">
                    {t('invalidCode')}
                  </p>
                )}
              </div>
            ) : (
              <Button onClick={() => setMode('join')} variant="outline" className="w-full">
                {t('joinCardTitle')}
              </Button>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function FamilyView() {
  const t = useTranslations('family');
  const locale = useLocale();
  const tCommon = useTranslations('common');
  const { data: session } = useSession();
  const { data: family, isLoading } = useFamily();
  const [copied, setCopied] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'member' | 'admin'>('member');
  const [editingName, setEditingName] = useState(false);
  const [newName, setNewName] = useState('');

  const leaveFamily = useLeaveFamily();
  const regenerateCode = useRegenerateInviteCode();
  const inviteMember = useInviteMember();
  const cancelInvite = useCancelInvite();
  const updateRole = useUpdateMemberRole();
  const removeMember = useRemoveMember();
  const updateFamily = useUpdateFamily();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!family) {
    return <NoFamilyView />;
  }

  // Match by email since session user id (external_id) differs from member id (UUID)
  const currentEmail = session?.user?.email;
  const currentMember = family.members.find((m) => m.email === currentEmail);
  const isAdmin = currentMember?.role === 'admin';

  const copyInviteCode = () => {
    navigator.clipboard.writeText(family.invite_code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleRegenerateCode = async () => {
    try {
      await regenerateCode.mutateAsync();
      toast.success(t('inviteCodeGeneratedToast'));
    } catch (error) {
      toast.error(t('inviteCodeGenerateError'));
    }
  };

  const handleInvite = async () => {
    if (!inviteEmail.trim()) return;
    try {
      await inviteMember.mutateAsync({ email: inviteEmail.trim(), role: inviteRole });
      toast.success(t('invitationSentToast'));
      setInviteEmail('');
    } catch (error) {
      toast.error(t('inviteSendError'));
    }
  };

  const handleUpdateName = async () => {
    if (!newName.trim()) return;
    try {
      await updateFamily.mutateAsync(newName.trim());
      toast.success(t('familyNameUpdatedToast'));
      setEditingName(false);
      setNewName('');
    } catch (error) {
      toast.error(t('familyNameUpdateError'));
    }
  };

  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6 py-2 sm:py-4">
      <PageHeader
        title={family.name}
        description={
          family.members.length === 1
            ? t('membersCountOne', { count: family.members.length })
            : t('membersCountOther', { count: family.members.length })
        }
        action={
          <>
            {isAdmin && (
              <Button
                variant="secondary"
                onClick={() => {
                  setNewName(family.name);
                  setEditingName(true);
                }}
              >
                {t('editName')}
              </Button>
            )}
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" className="text-destructive hover:text-destructive">
                  <LogOut className="h-4 w-4" strokeWidth={1.75} />
                  {t('leaveFamily')}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{t('leaveFamilyQuestion')}</AlertDialogTitle>
                  <AlertDialogDescription>
                    {isAdmin && family.members.length > 1
                      ? t('leaveAdminWarning')
                      : t('leaveConfirm')}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{tCommon('cancel')}</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => leaveFamily.mutate()}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    {leaveFamily.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : null}
                    {t('leaveAction')}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </>
        }
      />

      {/* Edit Name Dialog */}
      {editingName && (
        <Card className="border-0 bg-panel">
          <CardContent className="pt-5 sm:pt-6">
            <div className="flex flex-wrap gap-2">
              <Input
                aria-label={t('namePlaceholder')}
                className="min-w-[12rem] flex-1 bg-background"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder={t('namePlaceholder')}
                onKeyDown={(e) => e.key === 'Enter' && handleUpdateName()}
              />
              <Button onClick={handleUpdateName} disabled={updateFamily.isPending}>
                {updateFamily.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                {tCommon('save')}
              </Button>
              <Button variant="outline" onClick={() => setEditingName(false)}>
                {tCommon('cancel')}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Invite Code Card */}
      <Card>
        <CardHeader>
          <CardTitle>{t('inviteCodeCardTitle')}</CardTitle>
          <CardDescription>{t('inviteCodeCardDesc')}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 sm:gap-3">
            <code className="min-w-0 flex-1 truncate rounded-full bg-panel px-5 py-3 font-mono text-lg font-bold tracking-wider">
              {family.invite_code}
            </code>
            <Button
              variant="secondary"
              size="icon"
              onClick={copyInviteCode}
              aria-label={copied ? tCommon('copied') : t('copyCode')}
            >
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" strokeWidth={1.75} />}
            </Button>
            {isAdmin && (
              <Button
                variant="secondary"
                size="icon"
                aria-label={t('regenerate')}
                onClick={handleRegenerateCode}
                disabled={regenerateCode.isPending}
              >
                {regenerateCode.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" strokeWidth={1.75} />
                )}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Send Email Invite (Admin only) */}
      {isAdmin && (
        <Card>
          <CardHeader>
            <CardTitle>{t('sendInviteTitle')}</CardTitle>
            <CardDescription>{t('sendInviteDesc')}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                type="email"
                aria-label={t('sendInviteDesc')}
                className="sm:flex-1"
                placeholder={t('emailPlaceholder')}
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleInvite()}
              />
              <Select
                value={inviteRole}
                onValueChange={(v) => setInviteRole(v as 'member' | 'admin')}
              >
                <SelectTrigger className="sm:w-40" aria-label={t('roleLabel')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="member">{t('roleMember')}</SelectItem>
                  <SelectItem value="admin">{t('roleAdmin')}</SelectItem>
                </SelectContent>
              </Select>
              <Button onClick={handleInvite} disabled={!inviteEmail.trim() || inviteMember.isPending}>
                {inviteMember.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                <Mail className="h-4 w-4" strokeWidth={1.75} />
                {t('inviteButton')}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Members List */}
      <Card>
        <CardHeader>
          <CardTitle>{t('membersCardTitle')}</CardTitle>
          <CardDescription>{t('membersCardDesc')}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {family.members.map((member) => (
              <div
                key={member.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-panel p-4"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <Avatar>
                    <AvatarImage src={member.avatar_url} />
                    <AvatarFallback>{getInitials(member.display_name)}</AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-bold">{member.display_name}</span>
                      {member.email === currentEmail && (
                        <Badge variant="signature">
                          {t('youBadge')}
                        </Badge>
                      )}
                      {member.role === 'admin' && (
                        <Badge variant="amber">
                          <Crown className="h-3 w-3" aria-hidden />
                          {t('adminBadge')}
                        </Badge>
                      )}
                    </div>
                    <p className="truncate text-sm text-muted-foreground">{member.email}</p>
                  </div>
                </div>
                {isAdmin && member.email !== currentEmail && (
                  <div className="flex items-center gap-2">
                    <Select
                      value={member.role}
                      onValueChange={(role) =>
                        updateRole.mutate({ memberId: member.id, role })
                      }
                    >
                      <SelectTrigger className="w-36 bg-background" aria-label={t('roleLabel')}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="member">{t('roleMember')}</SelectItem>
                        <SelectItem value="admin">{t('roleAdmin')}</SelectItem>
                      </SelectContent>
                    </Select>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-destructive hover:bg-background hover:text-destructive"
                          aria-label={t('removeMember')}
                        >
                          <Trash2 className="h-4 w-4" strokeWidth={1.75} />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>{t('removeMemberQuestion')}</AlertDialogTitle>
                          <AlertDialogDescription>
                            {t('removeMemberConfirm', { name: member.display_name })}
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>{tCommon('cancel')}</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => removeMember.mutate(member.id)}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                          >
                            {t('removeAction')}
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Pending Invites */}
      {isAdmin && family.pending_invites.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>{t('pendingInvitesTitle')}</CardTitle>
            <CardDescription>{t('pendingInvitesDesc')}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {family.pending_invites.map((invite) => (
                <div
                  key={invite.id}
                  className="flex items-center justify-between gap-3 rounded-lg bg-panel p-4"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <div aria-hidden className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-pop-mint text-pop-foreground">
                      <Mail className="h-5 w-5" strokeWidth={1.75} />
                    </div>
                    <div className="min-w-0">
                      <span className="block truncate font-bold">{invite.email}</span>
                      <div className="flex items-center gap-1 text-sm text-muted-foreground">
                        <Clock className="h-3 w-3" />
                        {t('expires', { date: new Date(invite.expires_at).toLocaleDateString(locale) })}
                      </div>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-destructive hover:bg-background hover:text-destructive"
                    aria-label={t('cancelInvite')}
                    onClick={() => cancelInvite.mutate(invite.id)}
                    disabled={cancelInvite.isPending}
                  >
                    {cancelInvite.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4" strokeWidth={1.75} />
                    )}
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Family Outfits Feed */}
      <Card className="border-0 bg-signature-soft">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <span aria-hidden className="flex h-10 w-10 items-center justify-center rounded-full bg-signature text-signature-foreground">
              <Shirt className="h-5 w-5" strokeWidth={1.75} />
            </span>
            {t('familyOutfitsTitle')}
          </CardTitle>
          <CardDescription>{t('familyOutfitsDesc')}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild className="w-full">
            <Link href="/dashboard/family/feed">
              <Star className="h-4 w-4" strokeWidth={1.75} />
              {t('openFamilyFeed')}
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

export default function FamilyPage() {
  const { data: family, isLoading, isError } = useFamily();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // If error (404 - no family) or no data, show create/join view
  if (isError || !family) {
    return <NoFamilyView />;
  }

  return <FamilyView />;
}
