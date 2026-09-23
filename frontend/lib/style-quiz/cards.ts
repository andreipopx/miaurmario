/**
 * «Tu estilo con Stinky»: the swipe deck and its pure logic.
 *
 * The card **copy** lives in messages/{es,en}.json under
 * `firstRun.styleQuiz.cards.<id>`; what a card *means* (which item tags it
 * maps to) lives server-side in backend/app/utils/style_quiz.py, so the
 * stylist prompt and the non-AI scorer read one source of truth. Only the ids
 * travel: keep this list and the backend catalogue in sync (both sides have a
 * test that fails if they drift).
 *
 * No third-party imagery: each card is a text tile on a pop tint.
 */

export type StyleCardCategory = 'aesthetic' | 'silhouette' | 'palette';

export interface StyleCard {
  id: string;
  category: StyleCardCategory;
  /** Palette cards show the colours themselves — no photography, no scraping. */
  swatches?: readonly string[];
}

/** Deck order: looks first (easy to judge), then silhouettes, then palettes. */
export const STYLE_CARDS: readonly StyleCard[] = [
  { id: 'minimal', category: 'aesthetic' },
  { id: 'streetwear', category: 'aesthetic' },
  { id: 'tailored', category: 'aesthetic' },
  { id: 'boho', category: 'aesthetic' },
  { id: 'preppy', category: 'aesthetic' },
  { id: 'vintage', category: 'aesthetic' },
  { id: 'sporty', category: 'aesthetic' },
  { id: 'romantic', category: 'aesthetic' },
  { id: 'utility', category: 'aesthetic' },
  { id: 'oversize', category: 'silhouette' },
  { id: 'fitted', category: 'silhouette' },
  { id: 'wide-leg', category: 'silhouette' },
  { id: 'layers', category: 'silhouette' },
  { id: 'monochrome', category: 'palette', swatches: ['#5B6B73', '#7C8D96', '#9EB0B8', '#C3D2D8'] },
  { id: 'neutrals', category: 'palette', swatches: ['#EDE4D3', '#D6C3A5', '#B99C74', '#7C5F42'] },
  { id: 'black-white', category: 'palette', swatches: ['#111111', '#4D4D4D', '#B0B0B0', '#FFFFFF'] },
  { id: 'pastels', category: 'palette', swatches: ['#FBD5E3', '#D9E4FB', '#DDF3E0', '#FBEFD2'] },
  { id: 'brights', category: 'palette', swatches: ['#FF4D4D', '#FFB81C', '#3FD99A', '#56C2FF'] },
  { id: 'jewel', category: 'palette', swatches: ['#5C1730', '#123B2E', '#1B2A55', '#4A2065'] },
] as const;

export const STYLE_CARD_IDS: readonly string[] = STYLE_CARDS.map((c) => c.id);

/**
 * "Rápido": one broad look per family plus the palettes that split taste
 * fastest. Enough for the stylist to have an opinion in well under a minute;
 * "A fondo" asks all of them.
 */
export const QUICK_CARD_IDS: readonly string[] = [
  'minimal',
  'streetwear',
  'tailored',
  'vintage',
  'oversize',
  'neutrals',
  'brights',
] as const;

export type QuizLength = 'quick' | 'deep';

export const cardsFor = (length: QuizLength): readonly StyleCard[] =>
  length === 'quick' ? STYLE_CARDS.filter((c) => QUICK_CARD_IDS.includes(c.id)) : STYLE_CARDS;

/**
 * "Seguir afinando" after the short run: everything the deck has not asked
 * about yet, so nothing is answered twice.
 */
export function remainingCards(state: DeckState): readonly StyleCard[] {
  return STYLE_CARDS.filter((c) => !state.touched.includes(c.id));
}

export const FIT_CHOICES = ['holgado', 'ajustado', 'mixto'] as const;
export type FitChoice = (typeof FIT_CHOICES)[number];

/** Free-text answers: chips, so short and few. Mirrors MAX_CHIPS in the backend. */
export const MAX_CHIPS = 12;
export const MAX_CHIP_LENGTH = 60;

export type Swipe = 'like' | 'dislike' | 'pass';

/** What the deck has collected so far. */
export interface DeckState {
  /** How many cards of the current run have been answered (next card index). */
  index: number;
  liked: string[];
  disliked: string[];
  /** Cards the user acted on **in this run** — what "mezclar" overrides with. */
  touched: string[];
}

export const emptyDeck = (): DeckState => ({ index: 0, liked: [], disliked: [], touched: [] });

/** "Reajustar" / "mezclar" start with the saved answers already highlighted. */
export function deckFromProfile(profile: Pick<StyleQuizProfile, 'liked' | 'disliked'> | null | undefined): DeckState {
  const known = new Set(STYLE_CARD_IDS);
  return {
    ...emptyDeck(),
    liked: (profile?.liked ?? []).filter((id) => known.has(id)),
    disliked: (profile?.disliked ?? []).filter((id) => known.has(id)),
  };
}

const without = (list: readonly string[], id: string) => list.filter((x) => x !== id);

/**
 * Apply one swipe/tap. A card is never in both piles, and re-answering a card
 * (after going back) replaces the old answer instead of duplicating it.
 */
export function applySwipe(state: DeckState, swipe: Swipe, cards: readonly StyleCard[] = STYLE_CARDS): DeckState {
  const card = cards[state.index];
  if (!card) return state;
  const liked = without(state.liked, card.id);
  const disliked = without(state.disliked, card.id);
  return {
    index: Math.min(cards.length, state.index + 1),
    liked: swipe === 'like' ? [...liked, card.id] : liked,
    disliked: swipe === 'dislike' ? [...disliked, card.id] : disliked,
    // "Ni fu ni fa" counts as an answer too: in a merge it clears whatever the
    // user used to think about this card.
    touched: state.touched.includes(card.id) ? state.touched : [...state.touched, card.id],
  };
}

/**
 * "Seguir afinando" / continuing with another set of cards: keep the answers,
 * start the new run at its first card.
 */
export function continueDeck(state: DeckState): DeckState {
  return { ...state, index: 0 };
}

/** Step back one card. The answer stays until it is replaced. */
export function stepBack(state: DeckState): DeckState {
  return { ...state, index: Math.max(0, state.index - 1) };
}

export const isDeckDone = (state: DeckState, cards: readonly StyleCard[] = STYLE_CARDS): boolean =>
  state.index >= cards.length;

/** The answer already given for the card on screen, if we have come back to it. */
export function currentAnswer(state: DeckState, cards: readonly StyleCard[] = STYLE_CARDS): Swipe {
  const card = cards[state.index];
  if (!card) return 'pass';
  if (state.liked.includes(card.id)) return 'like';
  if (state.disliked.includes(card.id)) return 'dislike';
  return 'pass';
}

/** 0–100, for the progress bar. */
export function deckProgress(state: DeckState, cards: readonly StyleCard[] = STYLE_CARDS): number {
  if (cards.length === 0) return 100;
  return Math.round((Math.min(state.index, cards.length) / cards.length) * 100);
}

// --- The saved profile --------------------------------------------------------

export interface StyleQuizProfile {
  liked: string[];
  disliked: string[];
  brands: string[];
  never_wear: string[];
  colors_avoid: string[];
  occasions: string[];
  fit: FitChoice | null;
  completed: boolean;
  /** Shape of the stored answers; the backend owns both of these. */
  version?: number;
  /** ISO 8601, stamped on every save — "última vez que afinaste tu estilo". */
  updated_at?: string | null;
}

export interface StyleQuizResponse {
  profile: StyleQuizProfile;
  answered: boolean;
  /** Spanish sentences from the backend: exactly what Stinky reads. */
  summary: string[];
  cards: string[];
  max_chips: number;
  max_chip_length: number;
}

export const emptyProfile = (): StyleQuizProfile => ({
  liked: [],
  disliked: [],
  brands: [],
  never_wear: [],
  colors_avoid: [],
  occasions: [],
  fit: null,
  completed: false,
});

/**
 * Add a free-text chip. Trims, collapses whitespace, ignores blanks and
 * case-insensitive duplicates, and stops at the cap — same rules as the
 * backend, so what the user sees is what gets stored.
 */
export function addChip(list: readonly string[], value: string): string[] {
  const text = value.split(/\s+/).join(' ').trim().slice(0, MAX_CHIP_LENGTH).trim();
  if (!text || list.length >= MAX_CHIPS) return [...list];
  if (list.some((x) => x.toLocaleLowerCase() === text.toLocaleLowerCase())) return [...list];
  return [...list, text];
}

export const removeChip = (list: readonly string[], value: string): string[] => list.filter((x) => x !== value);

// --- Re-running the quiz ------------------------------------------------------

/** What the user picked when they chose to restyle from Ajustes. */
export type RestyleMode = 'fresh' | 'adjust' | 'merge';

export interface ProfileChange {
  card: string;
  from: Swipe;
  to: Swipe;
}

const answerIn = (profile: Pick<StyleQuizProfile, 'liked' | 'disliked'>, id: string): Swipe =>
  profile.liked.includes(id) ? 'like' : profile.disliked.includes(id) ? 'dislike' : 'pass';

/**
 * "Mezclar con lo anterior": the old profile wins on every card the user did
 * not see this time, and the fresh answer wins wherever they did. A run that
 * touched nothing leaves the profile exactly as it was.
 */
export function mergeDeck(previous: Pick<StyleQuizProfile, 'liked' | 'disliked'>, run: DeckState): Pick<StyleQuizProfile, 'liked' | 'disliked'> {
  const touched = new Set(run.touched);
  const liked = previous.liked.filter((id) => !touched.has(id));
  const disliked = previous.disliked.filter((id) => !touched.has(id));
  for (const id of run.touched) {
    if (run.liked.includes(id)) liked.push(id);
    else if (run.disliked.includes(id)) disliked.push(id);
  }
  const order = (ids: string[]) => STYLE_CARD_IDS.filter((id) => ids.includes(id));
  return { liked: order(liked), disliked: order(disliked) };
}

/** What changed between two profiles — for "has cambiado de idea en…". */
export function diffAnswers(
  before: Pick<StyleQuizProfile, 'liked' | 'disliked'>,
  after: Pick<StyleQuizProfile, 'liked' | 'disliked'>
): ProfileChange[] {
  const changes: ProfileChange[] = [];
  for (const id of STYLE_CARD_IDS) {
    const from = answerIn(before, id);
    const to = answerIn(after, id);
    if (from !== to) changes.push({ card: id, from, to });
  }
  return changes;
}

/** Is there anything worth saving? A pure skip should not overwrite old answers. */
export function hasAnswers(profile: StyleQuizProfile): boolean {
  return Boolean(
    profile.liked.length ||
      profile.disliked.length ||
      profile.brands.length ||
      profile.never_wear.length ||
      profile.colors_avoid.length ||
      profile.occasions.length ||
      profile.fit
  );
}
