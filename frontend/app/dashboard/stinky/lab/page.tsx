'use client';

/**
 * Stinky lab (hidden): the pre-rendered <Stinky> next to the vector <StinkySvg>, state by
 * state, then every coat × eyes, every accessory, light and dark, at the sizes the app uses.
 */

import { useState } from 'react';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { Stinky } from '@/components/stinky/stinky';
import { StinkySvg } from '@/components/stinky/stinky-svg';
import { STINKY_ACCESSORIES } from '@/components/stinky/stinky-accessory';
import { STINKY_STATES, type StinkyState } from '@/components/stinky/stinky-states';
import { STINKY_COATS, STINKY_EYES } from '@/lib/stinky-persona';
import { cn } from '@/lib/utils';

const SIZES = [40, 84, 128, 240] as const;

function Section({ title, children, dark }: { title: string; children: React.ReactNode; dark?: boolean }) {
  return (
    <section className={cn('rounded-lg p-4', dark ? 'dark bg-[#17161a] text-[#f5efe6]' : 'bg-card')}>
      <h2 className="mb-3 text-sm font-semibold">{title}</h2>
      {children}
    </section>
  );
}

export default function StinkyLabPage() {
  const t = useTranslations('stinkyLab');
  const [state, setState] = useState<StinkyState>('idle');
  const [plays, setPlays] = useState(0);
  const [done, setDone] = useState({ webp: 0, svg: 0 });
  const [pets, setPets] = useState({ webp: '', svg: '' });

  const trigger = (s: StinkyState) => {
    setState(s);
    setPlays((n) => n + 1);
  };

  return (
    <div className="mx-auto max-w-5xl space-y-4 pb-44 pt-2 sm:pt-4 lg:pb-28">
      <h1 className="font-wordmark text-[28px] font-black leading-none tracking-tight">{t('title')}</h1>
      <p className="text-sm text-muted-foreground">{t('intro')}</p>

      <Section title={t('states')}>
        <div className="mb-4 flex flex-wrap gap-2">
          {STINKY_STATES.map((s) => (
            <Button key={s} size="sm" variant={s === state ? 'default' : 'outline'} onClick={() => trigger(s)}>
              {s}
            </Button>
          ))}
        </div>
        <div className="flex flex-wrap items-start gap-8">
          {(['webp', 'svg'] as const).map((kind) => {
            const Head = kind === 'webp' ? Stinky : StinkySvg;
            return (
              <figure key={kind} className="flex flex-col items-center gap-2">
                <Head
                  key={`${kind}-${plays}`}
                  state={state}
                  size={200}
                  settleTo="idle"
                  onDone={() => setDone((d) => ({ ...d, [kind]: d[kind] + 1 }))}
                  onPet={(r) => setPets((p) => ({ ...p, [kind]: r }))}
                />
                <figcaption className="text-center text-xs text-muted-foreground">
                  <span className="block font-semibold text-foreground">{kind === 'webp' ? t('current') : t('vector')}</span>
                  {t('doneCount', { count: done[kind] })}
                  {pets[kind] && ` · ${t('lastPet', { reaction: pets[kind] })}`}
                </figcaption>
              </figure>
            );
          })}
        </div>
      </Section>

      {([false, true] as const).map((dark) => (
        <Section key={String(dark)} title={dark ? t('coatsDark') : t('coatsLight')} dark={dark}>
          <div className="space-y-2">
            {STINKY_EYES.map((eyes) => (
              <div key={eyes} className="flex flex-wrap items-end gap-1">
                <span className="w-14 text-[11px] opacity-70">{eyes}</span>
                {STINKY_COATS.map((coat) => (
                  <StinkySvg key={coat} coat={coat} eyes={eyes} size={84} interactive={false} label={coat} paused />
                ))}
              </div>
            ))}
            <div className="flex flex-wrap items-end gap-1 pt-2">
              <span className="w-14 text-[11px] opacity-70">{t('webpRow')}</span>
              {STINKY_COATS.map((coat) => (
                <Stinky key={coat} coat={coat} size={84} interactive={false} label={coat} paused />
              ))}
            </div>
          </div>
        </Section>
      ))}

      <Section title={t('accessories')}>
        <div className="flex flex-wrap gap-3">
          {STINKY_ACCESSORIES.map((accessory) => (
            <figure key={accessory} className="flex flex-col items-center gap-1">
              <StinkySvg accessory={accessory} size={128} interactive={false} label={accessory} state="idle" />
              <figcaption className="text-[11px] text-muted-foreground">{accessory}</figcaption>
            </figure>
          ))}
        </div>
      </Section>

      <Section title={t('sizes')}>
        <div className="flex flex-wrap items-end gap-6">
          {SIZES.map((size) => (
            <figure key={size} className="flex flex-col items-center gap-1">
              <div className="flex items-end gap-2">
                <Stinky size={size} interactive={false} label="" />
                <StinkySvg size={size} interactive={false} label="" />
              </div>
              <figcaption className="text-[11px] text-muted-foreground">{size}px</figcaption>
            </figure>
          ))}
        </div>
      </Section>
    </div>
  );
}
