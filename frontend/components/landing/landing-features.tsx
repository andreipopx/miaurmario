/* eslint-disable @next/next/no-img-element -- next/image is configured unoptimized; a plain
   <img> with explicit dimensions is smaller and avoids the runtime wrapper. */

import { getTranslations } from 'next-intl/server';

import { cn } from '@/lib/utils';

/**
 * Real screenshots of the running app (public/landing/*.webp), captured with
 * Playwright against a throwaway backend with seeded data and exported to WebP.
 * All four are the same phone-shaped crop, so one width/height pair is enough to
 * reserve the space and avoid any layout shift.
 */
const SHOT_WIDTH = 750;
const SHOT_HEIGHT = 1623;

const FEATURES = ['wardrobe', 'today', 'chat', 'friends'] as const;

// Design-system pop order (amber → sky → pink → mint), inlined rather than imported
// from components/chip.tsx because that module is client-only.
const POP_BG = ['bg-pop-amber', 'bg-pop-sky', 'bg-pop-pink', 'bg-pop-mint'] as const;

function PhoneShot({ src, alt }: { src: string; alt: string }) {
  return (
    <div className="mx-auto w-full max-w-[236px] rounded-[34px] bg-panel p-[6px] shadow-[0_18px_44px_rgba(0,0,0,0.13)] ring-1 ring-border sm:max-w-[262px] lg:max-w-[286px]">
      <img
        src={src}
        alt={alt}
        width={SHOT_WIDTH}
        height={SHOT_HEIGHT}
        loading="lazy"
        decoding="async"
        sizes="(min-width: 1024px) 286px, (min-width: 640px) 262px, 236px"
        className="block h-auto w-full rounded-[28px] bg-background"
      />
    </div>
  );
}

export async function LandingFeatures() {
  const t = await getTranslations('landing.features');

  return (
    <section aria-labelledby="landing-features-title" className="px-4 py-14 sm:px-6 sm:py-20">
      <div className="mx-auto max-w-5xl">
        <p className="eyebrow text-center">{t('eyebrow')}</p>
        <h2 id="landing-features-title" className="mt-1 text-balance text-center text-[26px] sm:text-[32px]">
          {t('title')}
        </h2>

        <ol className="mt-10 space-y-14 sm:mt-14 sm:space-y-20">
          {FEATURES.map((key, i) => (
            <li
              key={key}
              className="grid items-center gap-7 lg:grid-cols-2 lg:gap-14"
            >
              <div className={cn('lg:order-1', i % 2 === 1 && 'lg:order-2')}>
                <span
                  aria-hidden
                  className={cn(
                    'inline-flex h-8 w-8 items-center justify-center rounded-full text-[15px] font-extrabold text-pop-foreground',
                    POP_BG[i % POP_BG.length]
                  )}
                >
                  {i + 1}
                </span>
                <h3 className="mt-3 text-balance text-[21px] sm:text-[26px]">{t(`${key}.title`)}</h3>
                <p className="mt-2 text-pretty text-[15px] leading-relaxed text-muted-foreground sm:text-[17px]">
                  {t(`${key}.body`)}
                </p>
              </div>
              <div className={cn('lg:order-2', i % 2 === 1 && 'lg:order-1')}>
                <PhoneShot src={`/landing/${key}.webp`} alt={t(`${key}.alt`)} />
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
