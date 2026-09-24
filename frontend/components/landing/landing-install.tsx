import { getTranslations } from 'next-intl/server';
import { MoreVertical, Share, Smartphone } from 'lucide-react';

/**
 * "¿Es una app?" — the actual thing people get wrong before they even try it.
 * A logged-out, no-JavaScript version of /dashboard/install: no tabs, no
 * platform sniffing, just the two steps for iPhone and for Android side by side.
 */
function Steps({ title, icon, steps }: { title: string; icon: React.ReactNode; steps: React.ReactNode[] }) {
  return (
    <div className="rounded-lg bg-background p-5 ring-1 ring-border">
      <h3 className="flex items-center gap-2 text-[17px]">
        <span aria-hidden className="text-muted-foreground">
          {icon}
        </span>
        {title}
      </h3>
      <ol className="mt-4 space-y-3">
        {steps.map((step, i) => (
          <li key={i} className="flex items-start gap-3">
            <span
              aria-hidden
              className="mt-px flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-signature text-sm font-extrabold text-signature-foreground"
            >
              {i + 1}
            </span>
            {/* overflow-wrap:anywhere (not break-words): only "anywhere" also shrinks the
                min-content width, so the long domain cannot widen the grid column
                past the viewport at 320px with the browser font size turned up. */}
            <span className="min-w-0 pt-1 text-[15px] leading-snug [overflow-wrap:anywhere]">{step}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

export async function LandingInstall() {
  const t = await getTranslations('landing.install');
  const strong = (chunks: React.ReactNode) => <strong className="font-bold">{chunks}</strong>;

  return (
    <section aria-labelledby="landing-install-title" className="px-4 sm:px-6">
      <div className="mx-auto max-w-5xl rounded-[32px] bg-panel px-5 py-12 sm:px-10 sm:py-16">
        <p className="eyebrow">{t('eyebrow')}</p>
        <h2 id="landing-install-title" className="mt-1 text-balance text-[26px] sm:text-[32px]">
          {t('title')}
        </h2>
        <div className="mt-4 max-w-2xl space-y-3 text-pretty text-[15px] leading-relaxed text-muted-foreground sm:text-[17px]">
          <p>{t('lead')}</p>
          <p>{t('lead2')}</p>
        </div>

        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          <Steps
            title={t('iosTitle')}
            icon={<Smartphone className="h-[18px] w-[18px]" strokeWidth={1.75} aria-hidden />}
            steps={[
              t.rich('iosStep1', { strong }),
              t.rich('iosStep2', {
                strong,
                icon: () => (
                  <Share
                    className="mx-0.5 inline h-4 w-4 -translate-y-px align-middle"
                    strokeWidth={2}
                    aria-label={t('shareIcon')}
                  />
                ),
              }),
            ]}
          />
          <Steps
            title={t('androidTitle')}
            icon={<MoreVertical className="h-[18px] w-[18px]" strokeWidth={1.75} aria-hidden />}
            steps={[t.rich('androidStep1', { strong }), t.rich('androidStep2', { strong })]}
          />
        </div>

        <p className="mt-6 text-[14px] text-muted-foreground">{t('note')}</p>
      </div>
    </section>
  );
}
