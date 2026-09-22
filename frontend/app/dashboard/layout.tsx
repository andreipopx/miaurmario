'use client';

import { useState, useEffect, useCallback } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { Sidebar } from '@/components/sidebar';
import { MobileSidebar } from '@/components/mobile-sidebar';
import { MobileNav } from '@/components/mobile-nav';
import { Header } from '@/components/header';
import { OfflineIndicator } from '@/components/offline-indicator';
import { ImageLightbox } from '@/components/image-lightbox';
import { AnnouncementBanner } from '@/components/announcement-banner';
import { PushSync } from '@/components/install/push-sync';
import { LightboxProvider } from '@/lib/lightbox-context';
import { useAuth } from '@/lib/hooks/use-auth';
import { useTranslations } from 'next-intl';
import { PullToRefresh } from '@/components/native/pull-to-refresh';
import { SectionTabs } from '@/components/section-tabs';
import { FeatureTour } from '@/components/onboarding/feature-tour';
import { AreaTip } from '@/components/onboarding/area-tip';

/** Screens with pull-to-refresh (feeds and lists that change under you). */
const PULL_TO_REFRESH = new Set(['/dashboard', '/dashboard/wardrobe', '/dashboard/friends', '/dashboard/music']);

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const t = useTranslations('common');
  const closeSidebar = useCallback(() => setSidebarOpen(false), []);

  const { user, isAuthenticated, isLoading, error } = useAuth();

  useEffect(() => {
    // If auth check completed and user is not authenticated, redirect to login
    if (!isLoading && !isAuthenticated) {
      router.push('/login');
    }
  }, [isLoading, isAuthenticated, router]);

  // Check onboarding status from API user
  useEffect(() => {
    if (user && user.onboarding_completed === false) {
      router.push('/onboarding');
    }
  }, [user, router]);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-foreground" aria-hidden />
          <p className="text-sm font-medium text-muted-foreground">{t('loadingWardrobe')}</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  return (
    <LightboxProvider>
      <div className="min-h-screen bg-background">
        <Sidebar />
        <MobileSidebar open={sidebarOpen} onClose={closeSidebar} />
        <div className="lg:pl-64">
          <Header onMenuClick={() => setSidebarOpen(true)} />
          {/* pb-dock reserves room for the floating mobile dock so it never covers content. */}
          <main className="mx-auto max-w-6xl overflow-x-hidden px-4 pt-2 pb-dock sm:px-6 lg:px-10 lg:pb-12">
            <AnnouncementBanner />
            <SectionTabs />
            <AreaTip />
            {children}
          </main>
        </div>
        <MobileNav />
        {pathname && PULL_TO_REFRESH.has(pathname) && <PullToRefresh key={pathname} />}
        <OfflineIndicator />
        <PushSync />
        <ImageLightbox />
        {user?.onboarding_completed && <FeatureTour />}
      </div>
    </LightboxProvider>
  );
}
