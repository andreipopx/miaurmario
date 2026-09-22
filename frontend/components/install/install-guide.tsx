'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { BellRing, CheckCircle2, Download, Info, Monitor, MoreVertical, Share, Smartphone } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { StinkyAvatar } from '@/components/brand/stinky-avatar';
import { useInstallPrompt } from '@/lib/pwa/install-prompt';
import { currentPlatform, isStandalone, type InstallPlatform } from '@/lib/pwa/platform';
import { cn } from '@/lib/utils';

/** Tabs of the guide (Huawei Browser and other Android browsers share one). */
export type GuideTab = 'ios' | 'android' | 'other' | 'desktop';
const TABS: GuideTab[] = ['ios', 'android', 'other', 'desktop'];

export function guideTabFor(platform: InstallPlatform): GuideTab {
  if (platform === 'ios') return 'ios';
  if (platform === 'android-chrome') return 'android';
  if (platform === 'huawei' || platform === 'android-other') return 'other';
  return 'desktop';
}

const TAB_ICON: Record<GuideTab, React.ReactNode> = {
  ios: <Smartphone className="h-4 w-4" strokeWidth={1.75} aria-hidden />,
  android: <Smartphone className="h-4 w-4" strokeWidth={1.75} aria-hidden />,
  other: <MoreVertical className="h-4 w-4" strokeWidth={1.75} aria-hidden />,
  desktop: <Monitor className="h-4 w-4" strokeWidth={1.75} aria-hidden />,
};

function Steps({ steps }: { steps: React.ReactNode[] }) {
  return (
    <ol className="space-y-3">
      {steps.map((step, i) => (
        <li key={i} className="flex items-start gap-3">
          <span
            aria-hidden
            className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-signature text-sm font-extrabold text-signature-foreground"
          >
            {i + 1}
          </span>
          <span className="pt-1 text-[15px] leading-snug">{step}</span>
        </li>
      ))}
    </ol>
  );
}

function Note({ children, tone = 'soft' }: { children: React.ReactNode; tone?: 'soft' | 'amber' }) {
  return (
    <p
      className={cn(
        'flex items-start gap-2 rounded-lg px-4 py-3 text-sm',
        tone === 'amber' ? 'bg-pop-amber text-pop-foreground' : 'bg-signature-soft text-foreground'
      )}
    >
      {tone === 'amber' ? (
        <Info className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden />
      ) : (
        <BellRing className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden />
      )}
      <span>{children}</span>
    </p>
  );
}

const inlineIcon = 'mx-0.5 inline h-4 w-4 -translate-y-px align-middle';

export function InstallGuide({ className }: { className?: string }) {
  const t = useTranslations('install');
  const [detected, setDetected] = useState<GuideTab | null>(null);
  const [tab, setTab] = useState<GuideTab>('ios');
  const [standalone, setStandalone] = useState(false);
  const { canPrompt, justInstalled, promptInstall } = useInstallPrompt();

  useEffect(() => {
    const d = guideTabFor(currentPlatform());
    setDetected(d);
    setTab(d);
    setStandalone(isStandalone());
  }, []);

  if (standalone || justInstalled) {
    return (
      <div className={cn('flex flex-col items-center gap-3 py-4 text-center', className)}>
        <StinkyAvatar size={72} />
        <p className="flex items-center gap-2 font-bold">
          <CheckCircle2 className="h-5 w-5 text-pop-mint" strokeWidth={2} aria-hidden />
          {t('installed')}
        </p>
      </div>
    );
  }

  const handleInstall = async () => {
    const outcome = await promptInstall();
    if (outcome === 'accepted') toast.success(t('installedToast'));
  };

  const strong = (chunks: React.ReactNode) => <strong>{chunks}</strong>;

  return (
    <div className={cn('space-y-5', className)}>
      <div role="tablist" aria-label={t('platformLabel')} className="flex flex-wrap gap-2">
        {TABS.map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={cn(
              'pressable inline-flex h-10 items-center gap-1.5 rounded-full px-4 text-sm font-semibold transition-colors',
              tab === key ? 'bg-foreground text-background' : 'bg-panel text-foreground hover:bg-accent'
            )}
          >
            {TAB_ICON[key]}
            {t(`tabs.${key}`)}
            {detected === key && <span className="sr-only">{t('detected')}</span>}
          </button>
        ))}
      </div>

      {tab === 'ios' && (
        <div className="space-y-4">
          <Steps
            steps={[
              t.rich('ios.step1', { strong }),
              t.rich('ios.step2', {
                strong,
                icon: () => <Share className={inlineIcon} strokeWidth={2} aria-label={t('ios.shareIcon')} />,
              }),
              t.rich('ios.step3', { strong }),
              t.rich('ios.step4', { strong }),
            ]}
          />
          <Note>{t('ios.pushNote')}</Note>
          <p className="text-xs text-muted-foreground">{t('ios.otherBrowsers')}</p>
        </div>
      )}

      {tab === 'android' && (
        <div className="space-y-4">
          {canPrompt && (
            <Button variant="signature" size="lg" className="w-full sm:w-auto" onClick={handleInstall}>
              <Download className="h-4 w-4" strokeWidth={1.75} />
              {t('android.installButton')}
            </Button>
          )}
          <Steps
            steps={[
              t.rich('android.step1', { strong }),
              t.rich('android.step2', {
                strong,
                icon: () => <MoreVertical className={inlineIcon} strokeWidth={2} aria-label={t('menuIcon')} />,
              }),
              t.rich('android.step3', { strong }),
              t.rich('android.step4', { strong }),
            ]}
          />
          <Note>{t('android.pushNote')}</Note>
        </div>
      )}

      {tab === 'other' && (
        <div className="space-y-4">
          <Steps
            steps={[
              t.rich('other.step1', { strong }),
              t.rich('other.step2', { strong }),
              t.rich('other.step3', { strong }),
            ]}
          />
          <Note tone="amber">{t('other.pushNote')}</Note>
        </div>
      )}

      {tab === 'desktop' && (
        <div className="space-y-4">
          {canPrompt && (
            <Button variant="signature" onClick={handleInstall}>
              <Download className="h-4 w-4" strokeWidth={1.75} />
              {t('android.installButton')}
            </Button>
          )}
          <Steps
            steps={[
              t.rich('desktop.step1', { strong }),
              t.rich('desktop.step2', { strong }),
              t.rich('desktop.step3', { strong }),
            ]}
          />
        </div>
      )}
    </div>
  );
}

export function InstallGuideDialog({
  open,
  onOpenChange,
  reason,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Extra line on top, e.g. why push needs the app installed on iPhone. */
  reason?: React.ReactNode;
}) {
  const t = useTranslations('install');
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{reason ?? t('subtitle')}</DialogDescription>
        </DialogHeader>
        <InstallGuide />
      </DialogContent>
    </Dialog>
  );
}
