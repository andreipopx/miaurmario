'use client';

import { Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { toast } from 'sonner';
import { Loader2, UserPlus } from 'lucide-react';
import { useSession } from 'next-auth/react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useJoinFamilyByToken } from '@/lib/hooks/use-family';
import { ApiError } from '@/lib/api';
import { Stinky } from '@/components/stinky/stinky';

function useErrorMessage() {
  const t = useTranslations('invite');
  const tErrors = useTranslations('errors');
  return (error: unknown): string => {
    if (error instanceof ApiError) {
      if (error.status === 404) return t('invalidLink');
      if (error.status === 403) return t('wrongEmail');
      if (error.status === 409) return t('alreadyInFamily');
    }
    return tErrors('generic');
  };
}

function InviteContent() {
  const t = useTranslations('invite');
  const getErrorMessage = useErrorMessage();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { status } = useSession();
  const token = searchParams.get('token');
  const joinByToken = useJoinFamilyByToken();

  useEffect(() => {
    if (!token) {
      router.replace('/dashboard/family');
    } else if (status === 'unauthenticated') {
      router.replace(`/login?callbackUrl=${encodeURIComponent(`/invite?token=${token}`)}`);
    }
  }, [status, router, token]);

  if (!token) return null;

  if (status === 'loading' || status === 'unauthenticated') {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const handleAccept = async () => {
    try {
      const result = await joinByToken.mutateAsync(token);
      toast.success(t('joinedToast', { name: result.family_name }));
      router.push('/dashboard/family');
    } catch {
      // error displayed via joinByToken.error below
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md border-0 bg-panel">
        <CardHeader className="items-center text-center">
          <div className="mb-2 flex h-36 w-36 items-center justify-center rounded-full bg-signature-soft">
            <Stinky state={joinByToken.isError ? 'sad' : 'wave'} size={120} label="" />
          </div>
          <CardTitle className="flex items-center gap-2 text-2xl font-extrabold">
            <UserPlus className="h-5 w-5" strokeWidth={1.75} aria-hidden />
            {t('title')}
          </CardTitle>
          <CardDescription className="text-[15px]">{t('subtitle')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {joinByToken.isError && (
            <p role="alert" className="rounded-md bg-background px-4 py-3 text-sm font-medium text-destructive">
              {getErrorMessage(joinByToken.error)}
            </p>
          )}
          <Button
            onClick={handleAccept}
            size="lg"
            className="w-full"
            disabled={joinByToken.isPending || joinByToken.isSuccess}
          >
            {joinByToken.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            {t('accept')}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

export default function InvitePage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <InviteContent />
    </Suspense>
  );
}
