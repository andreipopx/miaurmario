'use client';

/* eslint-disable @next/next/no-img-element -- tiny static coat swatches */

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Check, Loader2 } from 'lucide-react';

import { Stinky } from '@/components/stinky/stinky';
import { stinkyNeutralStill } from '@/components/stinky/stinky-states';
import { useApplyStinkyPersona, useStinkyPersona } from '@/components/stinky/stinky-persona';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { haptic } from '@/lib/native/haptics';
import { useUpdateUserProfile, type UserProfile } from '@/lib/hooks/use-user';
import {
  DEFAULT_STINKY_COAT,
  DEFAULT_STINKY_EYES,
  DEFAULT_STINKY_NAME,
  DEFAULT_STINKY_PERSONA,
  STINKY_COATS,
  STINKY_EYES,
  STINKY_EYE_COLORS,
  STINKY_NAME_MAX_LENGTH,
  STINKY_NATURAL_EYES,
  cleanStinkyName,
  isDefaultPersona,
  personaFromProfile,
  type StinkyCoat,
  type StinkyEyes,
  type StinkyPersona,
} from '@/lib/stinky-persona';
import { cn } from '@/lib/utils';

/** A pair of cat eyes in that colour; "de serie" shows the coat's own (white: one blue, one gold). */
function EyeSwatch({ eyes, coat }: { eyes: StinkyEyes; coat: StinkyCoat }) {
  const own = eyes === 'natural' ? STINKY_NATURAL_EYES[coat] : eyes;
  const [left, right] = own
    ? [STINKY_EYE_COLORS[own], STINKY_EYE_COLORS[own]]
    : [STINKY_EYE_COLORS.azul, STINKY_EYE_COLORS.ambar];
  return (
    <span aria-hidden className="flex gap-[3px] rounded-full bg-[#151515] px-1.5 py-1.5">
      {[left, right].map((color, i) => (
        <span key={i} className="relative block h-3.5 w-3.5 rounded-full" style={{ background: color }}>
          <span className="absolute left-1/2 top-[15%] h-[70%] w-[22%] -translate-x-1/2 rounded-full bg-[#151515]" />
        </span>
      ))}
    </span>
  );
}

/**
 * Tu Stinky: name the stylist cat and pick his coat and eyes. The big head previews
 * the choice at once (he waves in each new look); nothing is saved until "Guardar",
 * and then the whole app, the chat and the notifications use it.
 */
export default function StinkyCustomizePage() {
  const t = useTranslations('stinkyCustomize');
  const persona = useStinkyPersona();
  const applyPersona = useApplyStinkyPersona();
  const update = useUpdateUserProfile();
  const queryClient = useQueryClient();

  const [name, setName] = useState(persona.name === DEFAULT_STINKY_NAME ? '' : persona.name);
  const [coat, setCoat] = useState<StinkyCoat>(persona.coat);
  const [eyes, setEyes] = useState<StinkyEyes>(persona.eyes);
  const [mood, setMood] = useState<'idle' | 'wave' | 'happy'>('wave');

  // Another device (or the account loading late) changed it: start from that.
  useEffect(() => {
    setName(persona.name === DEFAULT_STINKY_NAME ? '' : persona.name);
    setCoat(persona.coat);
    setEyes(persona.eyes);
  }, [persona.name, persona.coat, persona.eyes]);

  const trimmed = name.trim();
  const cleaned = trimmed ? cleanStinkyName(trimmed) : DEFAULT_STINKY_NAME;
  const invalid = cleaned === null;
  const shownName = cleaned ?? (trimmed || DEFAULT_STINKY_NAME);
  const dirty =
    !invalid && (cleaned !== persona.name || coat !== persona.coat || eyes !== persona.eyes);

  const pickCoat = (next: StinkyCoat) => {
    if (next === coat) return;
    haptic(6);
    setCoat(next);
    setMood('wave');
  };

  const pickEyes = (next: StinkyEyes) => {
    if (next === eyes) return;
    haptic(6);
    setEyes(next);
    setMood('wave');
  };

  const save = (next: StinkyPersona) => {
    update.mutate(
      {
        stinky_name: next.name === DEFAULT_STINKY_NAME ? null : next.name,
        stinky_coat: next.coat,
        stinky_eyes: next.eyes,
      },
      {
        onSuccess: (profile: UserProfile) => {
          queryClient.setQueryData(['auth-user'], profile);
          const saved = personaFromProfile(profile);
          applyPersona(saved);
          setMood('happy');
          haptic(12);
          toast.success(t('saved', { name: saved.name }));
        },
        onError: () => toast.error(t('saveError')),
      }
    );
  };

  const coatLabel = (c: StinkyCoat) => t(`coats.${c}` as never);

  return (
    <div className="mx-auto max-w-xl pb-44 pt-2 sm:pt-4 lg:pb-28">
      {/* Pinned under the header: the cat stays in sight while picking further down. */}
      <section
        aria-label={t('previewLabel', { name: shownName, coat: coatLabel(coat) })}
        className="sticky top-[calc(4rem+env(safe-area-inset-top))] z-10 -mx-1 flex flex-col items-center rounded-[32px] bg-signature-soft px-6 pb-4 pt-5 text-center shadow-[0_10px_24px_-18px_rgba(0,0,0,0.35)]"
      >
        <Stinky
          coat={coat}
          eyes={eyes}
          state={mood}
          size={148}
          settleTo="idle"
          onDone={() => setMood('idle')}
          label=""
        />
        <p
          className="mt-3 max-w-full truncate font-wordmark text-[32px] font-black leading-none tracking-tight"
          aria-hidden
        >
          {shownName}
        </p>
        <p className="mt-1.5 text-sm font-semibold text-muted-foreground">{coatLabel(coat)}</p>
      </section>

      <p className="mt-5 px-1 text-[15px] text-muted-foreground">{t('intro')}</p>

      <div className="mt-6 space-y-2">
        <label htmlFor="stinky-name" className="block px-1 text-sm font-bold">
          {t('nameLabel')}
        </label>
        <Input
          id="stinky-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={DEFAULT_STINKY_NAME}
          maxLength={STINKY_NAME_MAX_LENGTH + 10}
          autoComplete="off"
          autoCapitalize="words"
          enterKeyHint="done"
          aria-invalid={invalid || undefined}
          aria-describedby="stinky-name-hint"
          className={cn(invalid && 'border-destructive focus-visible:border-destructive')}
        />
        <p
          id="stinky-name-hint"
          className={cn('px-1 text-[13px]', invalid ? 'text-destructive' : 'text-muted-foreground')}
        >
          {invalid ? t('nameInvalid') : t('nameHint', { defaultName: DEFAULT_STINKY_NAME })}
        </p>
      </div>

      <fieldset className="mt-7">
        <legend className="mb-3 px-1 text-sm font-bold">{t('coatLabel')}</legend>
        <div className="grid grid-cols-4 gap-x-2 gap-y-4 sm:grid-cols-5">
          {STINKY_COATS.map((c) => {
            const selected = c === coat;
            return (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => pickCoat(c)}
                className="pressable group flex flex-col items-center gap-1.5 rounded-2xl focus-visible:outline-none"
              >
                <span
                  className={cn(
                    'relative flex aspect-square w-full max-w-[76px] items-center justify-center overflow-hidden rounded-full bg-panel ring-offset-2 ring-offset-background transition-shadow',
                    selected ? 'ring-[3px] ring-foreground' : 'group-focus-visible:ring-2 group-focus-visible:ring-ring'
                  )}
                >
                  {(['light', 'dark'] as const).map((variant) => (
                    <img
                      key={variant}
                      src={stinkyNeutralStill(variant, { small: true, coat: c, eyes })}
                      alt=""
                      aria-hidden
                      draggable={false}
                      loading="lazy"
                      className={cn(
                        'h-[118%] w-[118%] max-w-none translate-y-[5%] select-none object-contain',
                        variant === 'light' ? 'block dark:hidden' : 'hidden dark:block'
                      )}
                    />
                  ))}
                  {selected && (
                    <span className="absolute bottom-0.5 right-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-foreground text-background">
                      <Check className="h-3 w-3" strokeWidth={3} aria-hidden />
                    </span>
                  )}
                </span>
                <span
                  className={cn(
                    'text-center text-[12px] leading-tight',
                    selected ? 'font-bold text-foreground' : 'font-medium text-muted-foreground'
                  )}
                >
                  {coatLabel(c)}
                </span>
              </button>
            );
          })}
        </div>
      </fieldset>

      <fieldset className="mt-7">
        <legend className="mb-3 px-1 text-sm font-bold">{t('eyesLabel')}</legend>
        <div className="flex flex-wrap gap-2" role="radiogroup">
          {STINKY_EYES.map((e) => {
            const selected = e === eyes;
            const natural = e === 'natural';
            return (
              <button
                key={e}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => pickEyes(e)}
                className={cn(
                  'pressable flex h-11 items-center gap-2 rounded-full border-[1.5px] pl-2 pr-4 text-[14px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  selected ? 'border-foreground font-bold' : 'border-border font-medium text-muted-foreground'
                )}
              >
                <EyeSwatch eyes={e} coat={coat} />
                {natural ? t('eyes.natural') : t(`eyes.${e}` as never)}
              </button>
            );
          })}
        </div>
      </fieldset>

      {!isDefaultPersona(persona) && (
        <button
          type="button"
          onClick={() => {
            setName('');
            setCoat(DEFAULT_STINKY_COAT);
            setEyes(DEFAULT_STINKY_EYES);
            setMood('wave');
            save(DEFAULT_STINKY_PERSONA);
          }}
          disabled={update.isPending}
          className="mt-8 w-full text-center text-sm font-semibold text-muted-foreground underline-offset-4 hover:underline disabled:opacity-50"
        >
          {t('reset', { defaultName: DEFAULT_STINKY_NAME })}
        </button>
      )}

      {/* Above the dock, within thumb reach, and only once there is something to save. */}
      {(dirty || update.isPending) && (
        <div className="fixed bottom-float-1 left-1/2 z-float w-[calc(100vw-2rem)] max-w-xl -translate-x-1/2 animate-in fade-in slide-in-from-bottom-4 duration-200 lg:bottom-6 lg:ml-32">
          <Button
            size="lg"
            className="w-full shadow-lg"
            disabled={update.isPending}
            onClick={() => cleaned && save({ name: cleaned, coat, eyes })}
          >
            {update.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
            {t('save')}
          </Button>
        </div>
      )}
    </div>
  );
}
