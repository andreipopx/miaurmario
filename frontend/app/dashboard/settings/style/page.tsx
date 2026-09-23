'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Check, Heart, Loader2, Shuffle, Sparkles, Trash2, X } from 'lucide-react';

import { PageHeader } from '@/components/page-header';
import { ChipField } from '@/components/style-quiz/chip-field';
import { StyleCardTile } from '@/components/style-quiz/style-card-tile';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Chip } from '@/components/chip';
import { LazyStinky } from '@/components/native/lazy-stinky';
import { useFormatDate } from '@/lib/date-locale';
import { openStyleQuiz, useSaveStyleQuiz, useStyleQuiz } from '@/lib/hooks/use-style-quiz';
import {
  FIT_CHOICES,
  STYLE_CARDS,
  type StyleQuizProfile,
  type Swipe,
  emptyProfile,
} from '@/lib/style-quiz/cards';
import { cn } from '@/lib/utils';

/** Cycle a card through gusta → no me va → sin opinión. */
function nextAnswer(current: Swipe): Swipe {
  return current === 'pass' ? 'like' : current === 'like' ? 'dislike' : 'pass';
}

function answerOf(profile: StyleQuizProfile, id: string): Swipe {
  if (profile.liked.includes(id)) return 'like';
  if (profile.disliked.includes(id)) return 'dislike';
  return 'pass';
}

function setAnswer(profile: StyleQuizProfile, id: string, answer: Swipe): StyleQuizProfile {
  return {
    ...profile,
    liked: answer === 'like' ? [...profile.liked.filter((x) => x !== id), id] : profile.liked.filter((x) => x !== id),
    disliked:
      answer === 'dislike' ? [...profile.disliked.filter((x) => x !== id), id] : profile.disliked.filter((x) => x !== id),
  };
}

/**
 * Ajustes → Tu estilo: what Stinky learned, the three ways to re-run the
 * quiz, and the inline editor for "reajustar lo que tengo".
 *
 * Taste only — nothing here asks about or comments on the user's body.
 */
export default function StyleProfilePage() {
  const t = useTranslations('firstRun.styleQuiz');
  const formatDate = useFormatDate();

  const { data, isLoading } = useStyleQuiz();
  const save = useSaveStyleQuiz();

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<StyleQuizProfile>(emptyProfile);
  const [confirmReset, setConfirmReset] = useState(false);

  // Start editing from whatever is saved, and stay in sync while not editing.
  useEffect(() => {
    if (!editing && data?.profile) setDraft(data.profile);
  }, [editing, data?.profile]);

  const updatedAt = useMemo(() => {
    const raw = data?.profile.updated_at;
    if (!raw) return null;
    const date = new Date(raw);
    return Number.isNaN(date.getTime()) ? null : formatDate(date, 'medium');
  }, [data?.profile.updated_at, formatDate]);

  const saveDraft = () => {
    save.mutate(draft, {
      onSuccess: () => {
        setEditing(false);
        toast.success(t('savedToast'));
      },
      onError: () => toast.error(t('saveError')),
    });
  };

  const startFromScratch = () => {
    setConfirmReset(false);
    setEditing(false);
    // Clear first, so a quiz abandoned halfway really does leave nothing behind.
    save.mutate(emptyProfile(), {
      onSuccess: () => openStyleQuiz('fresh'),
      onError: () => toast.error(t('saveError')),
    });
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6 py-2 sm:py-4">
      <Button variant="ghost" asChild className="-ml-3 text-muted-foreground hover:text-foreground">
        <Link href="/dashboard/settings">{t('backToSettings')}</Link>
      </Button>

      <PageHeader title={t('pageTitle')} description={t('pageDescription')} />

      {/* --- What Stinky learned ------------------------------------------- */}
      <Card>
        <CardHeader>
          <CardTitle>{t('summary.title')}</CardTitle>
          {updatedAt && <CardDescription data-testid="style-updated-at">{t('lastTuned', { date: updatedAt })}</CardDescription>}
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">{t('loading')}</p>
          ) : data?.answered ? (
            <ul className="space-y-1.5 text-sm leading-snug text-muted-foreground" data-testid="style-summary">
              {data.summary.map((line) => (
                <li key={line} className="break-words rounded-quick bg-panel px-3 py-2">
                  {line}
                </li>
              ))}
            </ul>
          ) : (
            <div className="flex flex-col items-center gap-3 py-2 text-center">
              <LazyStinky state="sleepy" settleTo="idle" size={96} interactive={false} label="" />
              <p className="max-w-sm text-sm leading-snug text-muted-foreground">{t('emptyState')}</p>
              <Button variant="signature" onClick={() => openStyleQuiz('fresh')}>
                <Sparkles className="h-4 w-4" strokeWidth={2} aria-hidden />
                {t('startQuiz')}
              </Button>
            </div>
          )}
          <p className="mt-3 text-[13px] leading-snug text-muted-foreground">{t('summary.editable')}</p>
        </CardContent>
      </Card>

      {/* --- The three ways to re-run it ----------------------------------- */}
      {data?.answered && (
        <Card>
          <CardHeader>
            <CardTitle>{t('restyle.title')}</CardTitle>
            <CardDescription>{t('restyle.body')}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2">
            <Button
              variant="outline"
              className="h-auto w-full justify-start gap-3 whitespace-normal rounded-tile px-4 py-3 text-left"
              onClick={() => setEditing(true)}
              data-testid="restyle-adjust"
            >
              <Check className="h-5 w-5 shrink-0" strokeWidth={2} aria-hidden />
              <span className="min-w-0">
                <span className="block font-bold">{t('restyle.adjust.title')}</span>
                <span className="mt-0.5 block text-[13px] font-medium leading-snug text-muted-foreground">
                  {t('restyle.adjust.body')}
                </span>
              </span>
            </Button>

            <Button
              variant="outline"
              className="h-auto w-full justify-start gap-3 whitespace-normal rounded-tile px-4 py-3 text-left"
              onClick={() => openStyleQuiz('merge')}
              data-testid="restyle-merge"
            >
              <Shuffle className="h-5 w-5 shrink-0" strokeWidth={2} aria-hidden />
              <span className="min-w-0">
                <span className="block font-bold">{t('restyle.merge.title')}</span>
                <span className="mt-0.5 block text-[13px] font-medium leading-snug text-muted-foreground">
                  {t('restyle.merge.body')}
                </span>
              </span>
            </Button>

            <Button
              variant="outline"
              className="h-auto w-full justify-start gap-3 whitespace-normal rounded-tile px-4 py-3 text-left text-destructive hover:text-destructive"
              onClick={() => setConfirmReset(true)}
              data-testid="restyle-fresh"
            >
              <Trash2 className="h-5 w-5 shrink-0" strokeWidth={2} aria-hidden />
              <span className="min-w-0">
                <span className="block font-bold">{t('restyle.fresh.title')}</span>
                <span className="mt-0.5 block text-[13px] font-medium leading-snug text-muted-foreground">
                  {t('restyle.fresh.body')}
                </span>
              </span>
            </Button>
          </CardContent>
        </Card>
      )}

      {/* --- "Reajustar lo que tengo": the inline editor -------------------- */}
      {(editing || !data?.answered) && (
        <Card data-testid="style-editor">
          <CardHeader>
            <CardTitle>{t('editor.title')}</CardTitle>
            <CardDescription>{t('editor.body')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div>
              <p className="eyebrow">{t('editor.cards')}</p>
              <ul className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                {STYLE_CARDS.map((card) => {
                  const answer = answerOf(draft, card.id);
                  return (
                    <li key={card.id}>
                      <button
                        type="button"
                        onClick={() => setDraft((d) => setAnswer(d, card.id, nextAnswer(answer)))}
                        data-testid={`card-toggle-${card.id}`}
                        aria-label={t('editor.cycle', { card: t(`cards.${card.id}.title`), state: t(`answers.${answer}`) })}
                        className={cn(
                          'relative w-full rounded-tile text-left transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                          answer === 'like' && 'ring-2 ring-signature',
                          answer === 'dislike' && 'opacity-60 ring-2 ring-border'
                        )}
                      >
                        <StyleCardTile card={card} compact />
                        <span
                          className={cn(
                            'absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full',
                            answer === 'like' ? 'bg-signature text-signature-foreground' : answer === 'dislike' ? 'bg-foreground text-background' : 'bg-background/70 text-muted-foreground'
                          )}
                        >
                          {answer === 'like' ? (
                            <Heart className="h-4 w-4" strokeWidth={2.5} aria-hidden />
                          ) : answer === 'dislike' ? (
                            <X className="h-4 w-4" strokeWidth={2.5} aria-hidden />
                          ) : (
                            <span aria-hidden className="text-[11px] font-bold">
                              ?
                            </span>
                          )}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>

            <div>
              <p className="eyebrow">{t('fit.title')}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {FIT_CHOICES.map((fit) => (
                  <Chip key={fit} active={draft.fit === fit} onClick={() => setDraft((d) => ({ ...d, fit: d.fit === fit ? null : fit }))}>
                    {t(`fit.options.${fit}`)}
                  </Chip>
                ))}
              </div>
            </div>

            <ChipField
              testId="edit-brands"
              label={t('brands.title')}
              hint={t('brands.body')}
              placeholder={t('brands.placeholder')}
              values={draft.brands}
              onChange={(brands) => setDraft((d) => ({ ...d, brands }))}
            />
            <ChipField
              testId="edit-never"
              label={t('neverWear.title')}
              hint={t('neverWear.body')}
              placeholder={t('neverWear.placeholder')}
              values={draft.never_wear}
              onChange={(never_wear) => setDraft((d) => ({ ...d, never_wear }))}
            />
            <ChipField
              testId="edit-colors"
              label={t('colorsAvoid.title')}
              hint={t('colorsAvoid.body')}
              placeholder={t('colorsAvoid.placeholder')}
              values={draft.colors_avoid}
              onChange={(colors_avoid) => setDraft((d) => ({ ...d, colors_avoid }))}
            />
            <ChipField
              testId="edit-occasions"
              label={t('occasions.title')}
              hint={t('occasions.body')}
              placeholder={t('occasions.placeholder')}
              values={draft.occasions}
              onChange={(occasions) => setDraft((d) => ({ ...d, occasions }))}
            />

            <div className="flex flex-wrap gap-2">
              <Button variant="signature" onClick={saveDraft} disabled={save.isPending} data-testid="style-editor-save">
                {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Check className="h-4 w-4" strokeWidth={2.5} aria-hidden />}
                {t('editor.save')}
              </Button>
              {data?.answered && (
                <Button
                  variant="ghost"
                  onClick={() => {
                    setDraft(data.profile);
                    setEditing(false);
                  }}
                >
                  {t('editor.cancel')}
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      <AlertDialog open={confirmReset} onOpenChange={setConfirmReset}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('restyle.fresh.confirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('restyle.fresh.confirmBody')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('restyle.fresh.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={startFromScratch} data-testid="confirm-fresh">
              {t('restyle.fresh.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
