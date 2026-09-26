'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { toast } from 'sonner';
import { Check, ChevronLeft, Heart, Loader2, Settings2, Sparkles, X, Zap } from 'lucide-react';

import { ChipField } from '@/components/style-quiz/chip-field';
import { StyleCardTile } from '@/components/style-quiz/style-card-tile';
import { Stinky } from '@/components/stinky/stinky';
import { usePrefersReducedMotion } from '@/components/stinky/use-stinky-env';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/chip';
import { useSaveStyleQuiz, useStyleQuiz, useStyleQuizRequest } from '@/lib/hooks/use-style-quiz';
import { readLocalSeen, useSeenTips } from '@/lib/hooks/use-seen-tips';
import { STYLE_QUIZ_KEY, shouldAutoOpenStyleQuiz } from '@/lib/onboarding/first-run';
import { SizeFields } from '@/components/style-quiz/size-fields';
import { useHabitualSizes } from '@/lib/hooks/use-habitual-sizes';
import {
  FIT_CHOICES,
  GARMENT_PREFS,
  STYLE_CARDS,
  type DeckState,
  type Sizes,
  type ProfileChange,
  type QuizLength,
  type RestyleMode,
  type StyleCard,
  type StyleQuizProfile,
  type Swipe,
  applySwipe,
  cardsFor,
  continueDeck,
  currentAnswer,
  deckFromProfile,
  diffAnswers,
  emptyProfile,
  hasAnswers,
  isDeckDone,
  mergeDeck,
  remainingCards,
  stepBack,
} from '@/lib/style-quiz/cards';
import { cn } from '@/lib/utils';

/** The questions after the deck, per length. "A fondo" asks all of them. */
const TAIL_STEPS: Record<QuizLength, readonly TailStep[]> = {
  quick: ['fit', 'essentials'],
  deep: ['fit', 'sizes', 'likes', 'avoid'],
};

type TailStep = 'fit' | 'sizes' | 'essentials' | 'likes' | 'avoid';
/**
 * `garment` — "¿qué ropa quieres que te proponga?" — is asked once, before the
 * deck, because it changes the words Stinky uses for everything that follows.
 * It is optional: skipping it is an answer, and it means "de todo".
 */
type Phase = 'length' | 'garment' | 'deck' | TailStep | 'summary';

/** Drag distance that counts as a swipe, and the fly-out duration. */
const SWIPE_THRESHOLD = 72;
const FLY_MS = 200;

/**
 * «Tu estilo con Stinky»: a swipe deck of style cards plus a few free-text
 * questions, in a short or a long version. Opens once after the welcome tour
 * and again from Ajustes → Tu estilo, where the user picks how to re-run it
 * (from scratch, adjusting what is there, or merging).
 *
 * It is about taste, never about the person: no card, question or summary line
 * refers to anybody's body.
 *
 * Every swipe has a button and a keyboard equivalent (← / →), and the drag is
 * direct manipulation, so `prefers-reduced-motion` only drops the fly-out.
 */
export function StyleQuizDialog() {
  const t = useTranslations('firstRun.styleQuiz');
  const { user, local, markSeen } = useSeenTips();
  const request = useStyleQuizRequest();
  const reducedMotion = usePrefersReducedMotion();

  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>('length');
  const [length, setLength] = useState<QuizLength>('quick');
  const [mode, setMode] = useState<RestyleMode>('fresh');
  const [cards, setCards] = useState<readonly StyleCard[]>(STYLE_CARDS);
  const [visited, setVisited] = useState<readonly TailStep[]>([]);
  const [deck, setDeck] = useState<DeckState>(() => deckFromProfile(null));
  const [profile, setProfile] = useState<StyleQuizProfile>(emptyProfile);
  const [changes, setChanges] = useState<ProfileChange[]>([]);
  const [fly, setFly] = useState<Swipe | null>(null);
  const [dragX, setDragX] = useState(0);

  // The habitual sizes live with the other measurements, not in the quiz.
  const habitualSizes = useHabitualSizes();
  const [sizes, setSizes] = useState<Sizes>({});
  const sizesEdited = useRef(false);

  const autoOpened = useRef(false);
  const lastRequest = useRef(request.n);
  const flyTimer = useRef<ReturnType<typeof setTimeout>>();
  const pointer = useRef<{ id: number; x: number; y: number; owned: boolean } | null>(null);
  const primary = useRef<HTMLButtonElement>(null);

  const { data: saved } = useStyleQuiz();
  const save = useSaveStyleQuiz();

  const start = useCallback((next: RestyleMode, base: StyleQuizProfile | undefined) => {
    // "fresh" ignores whatever was saved; the other two build on it.
    const from = next === 'fresh' ? undefined : base;
    setMode(next);
    setProfile(from ? { ...from } : emptyProfile());
    setDeck(deckFromProfile(from ?? null));
    setCards(STYLE_CARDS);
    setVisited([]);
    setChanges([]);
    setPhase('length');
    setFly(null);
    setDragX(0);
    sizesEdited.current = false;
  }, []);

  // Start from whatever is already saved, until the user types over it.
  useEffect(() => {
    if (!sizesEdited.current) setSizes(habitualSizes.saved);
  }, [habitualSizes.saved]);

  // Once per load, after the tour has been dealt with.
  useEffect(() => {
    // Read storage directly: `local` may not have caught up on the first render.
    if (autoOpened.current || !shouldAutoOpenStyleQuiz(user, [...local, ...readLocalSeen(user?.id)])) return;
    autoOpened.current = true;
    start('fresh', undefined);
    setOpen(true);
  }, [user, local, start]);

  // "Repetir el test" from Ajustes, with the mode the user picked there.
  useEffect(() => {
    if (request.n === lastRequest.current) return;
    lastRequest.current = request.n;
    start(request.mode, saved?.profile);
    setOpen(true);
  }, [request, saved?.profile, start]);

  useEffect(() => () => clearTimeout(flyTimer.current), []);

  const tail = TAIL_STEPS[length];
  const card = cards[deck.index];
  const answered = currentAnswer(deck, cards);

  /** The first question of this length the user has not been through yet. */
  const nextTail = useCallback(
    (after?: TailStep): Phase => {
      const from = after ? tail.indexOf(after) + 1 : 0;
      for (let i = from; i < tail.length; i += 1) {
        if (!visited.includes(tail[i])) return tail[i];
      }
      return 'summary';
    },
    [tail, visited]
  );

  const goTo = useCallback((next: Phase) => {
    setPhase(next);
    if (next !== 'summary' && next !== 'deck' && next !== 'length' && next !== 'garment') {
      setVisited((seen) => (seen.includes(next) ? seen : [...seen, next]));
    }
  }, []);

  const advance = useCallback(
    (swipe: Swipe) => {
      setDragX(0);
      const next = applySwipe(deck, swipe, cards);
      setDeck(next);
      if (isDeckDone(next, cards)) goTo(nextTail());
    },
    [deck, cards, goTo, nextTail]
  );

  const choose = useCallback(
    (swipe: Swipe) => {
      if (!card || fly) return;
      if (reducedMotion || swipe === 'pass') {
        advance(swipe);
        return;
      }
      setFly(swipe);
      flyTimer.current = setTimeout(() => {
        setFly(null);
        advance(swipe);
      }, FLY_MS);
    },
    [card, fly, reducedMotion, advance]
  );

  // --- Dragging the top card (mouse, pen and touch via pointer events) ------
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (fly || e.button !== 0) return;
    pointer.current = { id: e.pointerId, x: e.clientX, y: e.clientY, owned: false };
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const p = pointer.current;
    if (!p || p.id !== e.pointerId) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    // Claim the gesture only once it is clearly horizontal, so a vertical
    // scroll of the dialog still works.
    if (!p.owned) {
      if (Math.abs(dx) < 8 || Math.abs(dx) <= Math.abs(dy)) return;
      p.owned = true;
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    setDragX(dx);
  };

  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    const p = pointer.current;
    pointer.current = null;
    if (!p || p.id !== e.pointerId) return;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    if (!p.owned) return;
    const dx = e.clientX - p.x;
    if (dx > SWIPE_THRESHOLD) choose('like');
    else if (dx < -SWIPE_THRESHOLD) choose('dislike');
    else setDragX(0);
  };

  // --- Saving and leaving ---------------------------------------------------
  /** The profile as it would be stored right now. */
  const payloadNow = useCallback(
    (completed: boolean): StyleQuizProfile => {
      const answers =
        mode === 'merge' && saved?.profile
          ? mergeDeck(saved.profile, deck)
          : { liked: deck.liked, disliked: deck.disliked };
      return { ...profile, ...answers, completed };
    },
    [mode, saved?.profile, deck, profile]
  );

  /** Sizes go to the profile, not to the quiz — and only if they were touched. */
  const saveSizesIfEdited = () => {
    if (!sizesEdited.current) return;
    habitualSizes.save(sizes).catch(() => toast.error(t('sizes.saveError')));
  };

  const finish = () => {
    saveSizesIfEdited();
    const payload = payloadNow(true);
    setProfile(payload);
    setChanges(saved?.answered ? diffAnswers(saved.profile, payload) : []);
    markSeen([STYLE_QUIZ_KEY]);
    save.mutate(payload, {
      onSuccess: () => setPhase('summary'),
      onError: () => {
        toast.error(t('saveError'));
        setPhase('summary');
      },
    });
  };

  /** "Saltar": keep whatever they already answered, never nag again. */
  const skip = () => {
    saveSizesIfEdited();
    const payload = payloadNow(false);
    markSeen([STYLE_QUIZ_KEY]);
    setOpen(false);
    if (hasAnswers(payload)) save.mutate(payload);
  };

  /** "Seguir afinando" after the short run: only the cards it never showed. */
  const keepGoing = () => {
    const rest = remainingCards(deck);
    setLength('deep');
    setCards(rest);
    setDeck(continueDeck(deck));
    setChanges([]);
    // `nextTail` still reads the short tail here, so pick the long one by hand.
    const firstUnseen = TAIL_STEPS.deep.find((step) => !visited.includes(step));
    setPhase(rest.length > 0 ? 'deck' : (firstUnseen ?? 'summary'));
  };

  const back = () => {
    if (phase === 'garment') {
      setPhase('length');
      return;
    }
    if (phase === 'deck') {
      if (deck.index === 0) {
        setPhase('garment');
        return;
      }
      setDragX(0);
      setDeck((state) => stepBack(state));
      return;
    }
    const i = tail.indexOf(phase as TailStep);
    if (i <= 0) {
      setDeck((state) => stepBack({ ...state, index: cards.length }));
      setPhase('deck');
    } else {
      setPhase(tail[i - 1]);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (phase !== 'deck' || !card) return;
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      choose('like');
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      choose('dislike');
    }
  };

  const canGoBack = phase !== 'summary' && phase !== 'length';

  // The deck is most of the journey; the questions share what is left.
  const progress = useMemo(() => {
    if (phase === 'length') return 0;
    if (phase === 'garment') return 4;
    if (phase === 'summary') return 100;
    if (phase === 'deck') {
      return cards.length === 0 ? 75 : Math.round((Math.min(deck.index, cards.length) / cards.length) * 75);
    }
    return Math.round(75 + (25 * (tail.indexOf(phase as TailStep) + 1)) / (tail.length + 1));
  }, [phase, cards.length, deck.index, tail]);

  const summary = save.data?.summary ?? [];
  const isLastQuestion =
    phase !== 'deck' &&
    phase !== 'length' &&
    phase !== 'garment' &&
    phase !== 'summary' &&
    tail.indexOf(phase) === tail.length - 1;

  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(o) => {
        if (o) setOpen(true);
        // Esc on the summary: already saved, so just leave.
        else if (phase === 'summary') setOpen(false);
        else skip();
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-modal bg-black/50 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=open]:fade-in-0 motion-reduce:animate-none" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          onKeyDown={onKeyDown}
          onPointerDownOutside={(e) => e.preventDefault()}
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            primary.current?.focus({ preventScroll: true });
          }}
          data-testid="style-quiz"
          className={cn(
            'fixed left-1/2 top-1/2 z-modal flex max-h-[calc(100dvh-1.5rem)] w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 flex-col overflow-y-auto rounded-lg bg-background shadow-[0_20px_60px_rgba(0,0,0,0.25)] focus:outline-none',
            'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 motion-reduce:animate-none'
          )}
        >
          <DialogPrimitive.Title className="sr-only">{t('dialogLabel')}</DialogPrimitive.Title>

          <div className="flex items-center justify-between gap-1 px-4 pt-3">
            {/* In the deck the back control lives up here: the card and its
                three buttons already fill the bottom of the dialog. */}
            {phase === 'deck' && (
              <Button variant="ghost" size="icon" onClick={back} aria-label={t('back')} className="-ml-3 h-9 w-9 shrink-0">
                <ChevronLeft className="h-5 w-5" strokeWidth={2} aria-hidden />
              </Button>
            )}
            <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-muted-foreground" aria-live="polite">
              {phase === 'deck'
                ? t('cardOf', { current: Math.min(deck.index + 1, cards.length), total: cards.length })
                : t(`steps.${phase}`)}
            </span>
            {phase !== 'summary' && (
              <button
                type="button"
                onClick={skip}
                className="-mr-2 min-h-[44px] shrink-0 rounded-full px-3 text-sm font-semibold text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {t('skip')}
              </button>
            )}
          </div>

          {phase !== 'length' && (
            <div className="px-4 pt-2">
              <div
                role="progressbar"
                aria-valuenow={progress}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={t('progressLabel')}
                className="h-2 w-full overflow-hidden rounded-full bg-panel"
              >
                <span
                  className="block h-full rounded-full bg-signature transition-[width] duration-200 motion-reduce:transition-none"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          )}

          {phase === 'length' && (
            <div className="px-4 pb-2 pt-3 text-center">
              <div className="mx-auto flex h-24 w-24 items-center justify-center rounded-full bg-signature-soft">
                <Stinky state="wave" settleTo="idle" size={88} interactive={false} label="" />
              </div>
              <h2 className="mt-3 text-[20px] font-extrabold leading-tight tracking-[-0.02em]">{t('length.title')}</h2>
              <p className="mt-1 text-sm leading-snug text-muted-foreground">
                {mode === 'merge' ? t('length.bodyMerge') : t('length.body')}
              </p>
              <div className="mt-4 flex flex-col gap-2">
                {(['quick', 'deep'] as const).map((option, i) => (
                  <button
                    key={option}
                    ref={i === 0 ? primary : undefined}
                    type="button"
                    data-testid={`quiz-length-${option}`}
                    onClick={() => {
                      setLength(option);
                      setCards(cardsFor(option));
                      setDeck((state) => continueDeck(state));
                      setPhase('garment');
                    }}
                    className="flex min-w-0 items-center gap-3 rounded-tile border-[1.5px] border-border bg-background px-4 py-3 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-panel">
                      {option === 'quick' ? (
                        <Zap className="h-5 w-5" strokeWidth={2} aria-hidden />
                      ) : (
                        <Sparkles className="h-5 w-5" strokeWidth={2} aria-hidden />
                      )}
                    </span>
                    <span className="min-w-0">
                      <span className="block break-words font-bold">{t(`length.${option}.title`)}</span>
                      <span className="mt-0.5 block break-words text-[13px] leading-snug text-muted-foreground">
                        {t(`length.${option}.body`, { cards: cardsFor(option).length })}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Asked once, before the deck: it decides the words Stinky uses for
              every garment after this. About clothes, never about the person —
              and leaving it alone is a perfectly good answer. */}
          {phase === 'garment' && (
            <div className="px-4 pb-2 pt-4" data-testid="quiz-garment">
              <h2 className="text-[20px] font-extrabold leading-tight tracking-[-0.02em]">{t('garment.title')}</h2>
              <p className="mt-1 text-sm leading-snug text-muted-foreground">{t('garment.body')}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {GARMENT_PREFS.map((option) => (
                  <Chip
                    key={option}
                    active={profile.garment_pref === option}
                    data-testid={`garment-${option}`}
                    onClick={() =>
                      setProfile((p) => ({ ...p, garment_pref: p.garment_pref === option ? null : option }))
                    }
                  >
                    {t(`garment.options.${option}`)}
                  </Chip>
                ))}
              </div>
              <p className="mt-3 text-[13px] leading-snug text-muted-foreground">{t('garment.note')}</p>
            </div>
          )}

          {phase === 'sizes' && (
            <div className="px-4 pb-2 pt-4" data-testid="quiz-sizes">
              <h2 className="text-[20px] font-extrabold leading-tight tracking-[-0.02em]">{t('sizes.title')}</h2>
              <p className="mt-1 text-sm leading-snug text-muted-foreground">{t('sizes.body')}</p>
              <div className="mt-3">
                <SizeFields
                  values={sizes}
                  onChange={(next) => {
                    sizesEdited.current = true;
                    setSizes(next);
                  }}
                />
              </div>
            </div>
          )}

          {phase === 'deck' && card && (
            <div className="px-4 pb-2 pt-3">
              <div className="mb-2">
                <p className="text-center text-[15px] font-semibold">{t('deckPrompt')}</p>
                {/* What the three buttons do, said once, on the first card. */}
                {deck.index === 0 && (
                  <p className="mt-0.5 break-words text-center text-[12px] leading-snug text-muted-foreground" data-testid="deck-intro">
                    {t('deckIntro')}
                  </p>
                )}
              </div>

              <div className="relative h-[clamp(190px,36vh,280px)] select-none">
                {/* The next card peeks from behind so the deck reads as a deck. */}
                {cards[deck.index + 1] && (
                  <div aria-hidden className="absolute inset-x-2 top-2 h-full scale-[0.96] opacity-60">
                    <StyleCardTile card={cards[deck.index + 1]} />
                  </div>
                )}
                <div
                  data-testid="style-quiz-card"
                  role="group"
                  aria-roledescription={t('cardRole')}
                  aria-label={t(`cards.${card.id}.title`)}
                  onPointerDown={onPointerDown}
                  onPointerMove={onPointerMove}
                  onPointerUp={endDrag}
                  onPointerCancel={endDrag}
                  className={cn(
                    'absolute inset-0 touch-pan-y',
                    fly || dragX === 0 ? 'transition-transform duration-200 ease-pop motion-reduce:transition-none' : ''
                  )}
                  style={{
                    transform: fly
                      ? `translateX(${fly === 'like' ? 130 : -130}%) rotate(${fly === 'like' ? 12 : -12}deg)`
                      : `translateX(${dragX}px) rotate(${dragX / 24}deg)`,
                    opacity: fly ? 0 : 1,
                  }}
                >
                  <StyleCardTile card={card} className="h-full shadow-[0_8px_24px_rgba(0,0,0,0.10)]" />
                </div>
              </div>

              <div className="mt-4 flex items-center justify-center gap-3">
                <Button
                  variant="outline"
                  size="lg"
                  onClick={() => choose('dislike')}
                  aria-label={t('dislikeCard', { card: t(`cards.${card.id}.title`) })}
                  // Coming back to an answered card shows what was picked.
                  className={cn('h-14 w-14 shrink-0 rounded-full p-0', answered === 'dislike' && 'ring-4 ring-ring/40')}
                >
                  <X className="h-6 w-6" strokeWidth={2.5} aria-hidden />
                </Button>
                {/* "Ni fu ni fa" is a skip, not an answer: it says so on the
                    button, because it is the only one that changes nothing. */}
                <Button
                  variant="ghost"
                  onClick={() => choose('pass')}
                  aria-label={t('skipCardLabel')}
                  data-testid="quiz-pass"
                  className="h-14 min-w-0 flex-1 flex-col gap-0 px-2 py-1 leading-tight"
                >
                  <span className="max-w-full truncate text-sm font-semibold">{t('skipCard')}</span>
                  <span className="max-w-full truncate text-[11px] font-medium text-muted-foreground">{t('skipCardHint')}</span>
                </Button>
                <Button
                  variant="signature"
                  size="lg"
                  onClick={() => choose('like')}
                  aria-label={t('likeCard', { card: t(`cards.${card.id}.title`) })}
                  className={cn('h-14 w-14 shrink-0 rounded-full p-0', answered === 'like' && 'ring-4 ring-ring/40')}
                >
                  <Heart className="h-6 w-6" strokeWidth={2.5} aria-hidden />
                </Button>
              </div>
              <p className="mt-2 text-center text-[13px] text-muted-foreground">{t('deckHint')}</p>
            </div>
          )}

          {phase === 'fit' && (
            <div className="px-4 pb-2 pt-4">
              <h2 className="text-[20px] font-extrabold leading-tight tracking-[-0.02em]">{t('fit.title')}</h2>
              <p className="mt-1 text-sm leading-snug text-muted-foreground">{t('fit.body')}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {FIT_CHOICES.map((fit) => (
                  <Chip key={fit} active={profile.fit === fit} onClick={() => setProfile((p) => ({ ...p, fit: p.fit === fit ? null : fit }))}>
                    {t(`fit.options.${fit}`)}
                  </Chip>
                ))}
              </div>
            </div>
          )}

          {(phase === 'essentials' || phase === 'avoid') && (
            <div className="space-y-4 px-4 pb-2 pt-4">
              <ChipField
                testId="quiz-never"
                label={t('neverWear.title')}
                hint={t('neverWear.body')}
                placeholder={t('neverWear.placeholder')}
                values={profile.never_wear}
                onChange={(never_wear) => setProfile((p) => ({ ...p, never_wear }))}
              />
              {phase === 'essentials' ? (
                <ChipField
                  testId="quiz-occasions"
                  label={t('occasions.title')}
                  hint={t('occasions.body')}
                  placeholder={t('occasions.placeholder')}
                  values={profile.occasions}
                  onChange={(occasions) => setProfile((p) => ({ ...p, occasions }))}
                />
              ) : (
                <ChipField
                  testId="quiz-colors"
                  label={t('colorsAvoid.title')}
                  hint={t('colorsAvoid.body')}
                  placeholder={t('colorsAvoid.placeholder')}
                  values={profile.colors_avoid}
                  onChange={(colors_avoid) => setProfile((p) => ({ ...p, colors_avoid }))}
                />
              )}
            </div>
          )}

          {phase === 'likes' && (
            <div className="space-y-4 px-4 pb-2 pt-4">
              <ChipField
                testId="quiz-brands"
                label={t('brands.title')}
                hint={t('brands.body')}
                placeholder={t('brands.placeholder')}
                values={profile.brands}
                onChange={(brands) => setProfile((p) => ({ ...p, brands }))}
              />
              <ChipField
                testId="quiz-occasions"
                label={t('occasions.title')}
                hint={t('occasions.body')}
                placeholder={t('occasions.placeholder')}
                values={profile.occasions}
                onChange={(occasions) => setProfile((p) => ({ ...p, occasions }))}
              />
            </div>
          )}

          {phase === 'summary' && (
            <div className="px-4 pb-2 pt-3 text-center">
              <div className="mx-auto flex h-28 w-28 items-center justify-center rounded-full bg-signature-soft">
                <Stinky state="happy" settleTo="idle" size={100} interactive={false} label="" />
              </div>
              <h2 className="mt-3 text-[20px] font-extrabold leading-tight tracking-[-0.02em]">{t('summary.title')}</h2>

              {changes.length > 0 && (
                <p className="mt-2 break-words text-[13px] leading-snug text-muted-foreground" data-testid="style-quiz-changes">
                  {t('summary.changed', {
                    list: changes.map((c) => t(`cards.${c.card}.title`)).join(', '),
                    count: changes.length,
                  })}
                </p>
              )}

              {summary.length > 0 ? (
                <ul className="mt-3 space-y-1.5 text-left text-sm leading-snug text-muted-foreground" data-testid="style-quiz-summary">
                  {summary.map((line) => (
                    <li key={line} className="break-words rounded-quick bg-panel px-3 py-2">
                      {line}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-3 text-sm leading-snug text-muted-foreground">{t('summary.empty')}</p>
              )}

              <p className="mt-3 text-[13px] leading-snug text-muted-foreground">{t('summary.editable')}</p>

              <div className="mt-3 flex flex-col gap-2">
                {length === 'quick' && (
                  <Button variant="outline" className="w-full" onClick={keepGoing} data-testid="style-quiz-keep-going">
                    <Sparkles className="h-4 w-4" strokeWidth={2} aria-hidden />
                    {t('summary.keepGoing')}
                  </Button>
                )}
                <Button variant="outline" asChild className="w-full">
                  <Link href="/dashboard/settings/style" onClick={() => setOpen(false)}>
                    <Settings2 className="h-4 w-4" strokeWidth={2} aria-hidden />
                    {t('summary.editNow')}
                  </Link>
                </Button>
              </div>
            </div>
          )}

          <div className={cn('flex items-center gap-2 px-4 pb-4 pt-3', phase === 'deck' && 'hidden')}>
            {canGoBack && phase !== 'deck' && (
              <Button variant="ghost" size="icon" onClick={back} aria-label={t('back')} className="shrink-0">
                <ChevronLeft className="h-5 w-5" strokeWidth={2} aria-hidden />
              </Button>
            )}
            {phase === 'length' ? null : phase === 'garment' ? (
              <Button ref={primary} className="min-w-0 flex-1" onClick={() => setPhase('deck')} data-testid="quiz-garment-next">
                {t('next')}
              </Button>
            ) : phase === 'summary' ? (
              <Button variant="signature" className="min-w-0 flex-1" onClick={() => setOpen(false)}>
                {t('done')}
              </Button>
            ) : isLastQuestion ? (
              <Button ref={primary} variant="signature" className="min-w-0 flex-1" onClick={finish} disabled={save.isPending}>
                {save.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                ) : (
                  <Check className="h-4 w-4" strokeWidth={2.5} aria-hidden />
                )}
                {t('finish')}
              </Button>
            ) : (
              <Button ref={primary} className="min-w-0 flex-1" onClick={() => goTo(nextTail(phase as TailStep))}>
                {t('next')}
              </Button>
            )}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
