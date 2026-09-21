'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Link2, Share2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/hooks/use-auth';
import { profileShareUrl } from '@/lib/hooks/use-social';
import { shareOrCopy } from '@/lib/social';

/** Share-invite button for /u/{username}: native share sheet on mobile, copy elsewhere. */
export function ShareProfileButton({
  variant = 'default',
  className,
  label,
}: {
  variant?: 'default' | 'signature' | 'secondary';
  className?: string;
  label?: string;
}) {
  const t = useTranslations('social.invite');
  const { user } = useAuth();
  const username = user?.username;

  if (!username) {
    return (
      <Button asChild variant={variant} className={className}>
        <Link href="/onboarding/username">{t('setUsername')}</Link>
      </Button>
    );
  }

  const onShare = async () => {
    const url = profileShareUrl(username);
    const outcome = await shareOrCopy({ url, title: 'Miaurmario', text: t('shareText') });
    if (outcome === 'copied') toast.success(t('copied'));
    else if (outcome === 'failed') toast.error(t('copyFailed', { url }));
  };

  return (
    <Button variant={variant} className={className} onClick={onShare}>
      <Share2 className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden />
      {label ?? t('cta')}
    </Button>
  );
}

/** Pink card: your link + share button. */
export function InviteCard({ className }: { className?: string }) {
  const t = useTranslations('social.invite');
  const { user } = useAuth();
  return (
    <section className={cn('rounded-lg bg-signature-soft p-4 sm:p-5', className)} aria-labelledby="invite-title">
      <h2 id="invite-title" className="text-[15px] font-bold">
        {t('title')}
      </h2>
      <p className="mt-1 text-sm text-foreground/75">{t('body')}</p>
      {user?.username && (
        <p className="mt-3 flex items-center gap-2 truncate rounded-full bg-background px-4 py-2.5 text-sm font-semibold">
          <Link2 className="h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden />
          <span className="truncate">{profileShareUrl(user.username).replace(/^https?:\/\//, '')}</span>
        </p>
      )}
      <ShareProfileButton className="mt-3 w-full sm:w-auto" />
    </section>
  );
}
