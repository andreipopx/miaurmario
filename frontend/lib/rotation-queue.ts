/**
 * The bookkeeping behind rotating a batch of photos without waiting for any of them.
 *
 * Kept out of React so it can be tested for what actually went wrong: rotating one
 * photo used to block the next one, so straightening a wardrobe was a sequence of
 * little waits. The fix is not "more requests at once" — it is noticing that turns
 * are *additive*. Four taps are no turn at all, five are one, and a photo the user
 * is still turning should not be generating requests for intermediate positions
 * nobody will ever see.
 *
 * So each photo keeps two numbers: `shown`, the turns the preview is already drawn
 * at, and `saved`, the turns the server has stored. The gap between them is the work
 * outstanding. One request per photo is in flight at a time — they would collide on
 * the same files otherwise — but different photos go in parallel, and while a request
 * is in the air further taps just move `shown`, so they are all settled by the one
 * request that follows.
 */

export type TurnDirection = 'cw' | 'ccw';

export interface RotationEntry {
  /** Turns the user can see, 0-3. */
  shown: number;
  /** Turns the server has written, 0-3. */
  saved: number;
  /** True while a request for this photo is in flight. */
  busy: boolean;
}

export type RotationState = Readonly<Record<string, RotationEntry>>;

/** A quarter turn count brought back into 0-3, for either sign. */
export function normalise(quarters: number): number {
  return ((quarters % 4) + 4) % 4;
}

export const EMPTY_ENTRY: RotationEntry = { shown: 0, saved: 0, busy: false };

export function entryOf(state: RotationState, id: string): RotationEntry {
  return state[id] ?? EMPTY_ENTRY;
}

/** Total turns the user has asked for, counted from the photo as it was first drawn. */
export function turnsShown(state: RotationState, id: string): number {
  return entryOf(state, id).shown;
}

/**
 * What the preview must add on top of the stored file.
 *
 * Only the turns the server has NOT written yet: once a turn is saved the file
 * itself comes back rotated, and leaving the transform on would show it turned
 * twice. That is exactly the bug this replaced.
 */
export function turnsPending(state: RotationState, id: string): number {
  const entry = entryOf(state, id);
  return normalise(entry.shown - entry.saved);
}

/** Record a tap: the preview moves now, the server catches up later. */
export function applyTurn(
  state: RotationState,
  id: string,
  direction: TurnDirection
): RotationState {
  const entry = entryOf(state, id);
  return {
    ...state,
    [id]: { ...entry, shown: normalise(entry.shown + (direction === 'cw' ? 1 : -1)) },
  };
}

/**
 * The single request that would bring the server in line with what is on screen.
 *
 * `null` when there is nothing to do — which is the whole point: a user who tapped
 * four times, or twice each way, has asked for no change at all and we send nothing.
 * Otherwise it is always the *shortest* way round, so three taps right become one
 * turn left rather than three turns right.
 */
export function pendingRequest(
  state: RotationState,
  id: string
): { direction: TurnDirection; quarters: number } | null {
  const entry = entryOf(state, id);
  if (entry.busy) return null;
  const gap = normalise(entry.shown - entry.saved);
  if (gap === 0) return null;
  return gap === 3 ? { direction: 'ccw', quarters: 1 } : { direction: 'cw', quarters: gap };
}

/** Mark a photo as having a request in the air. */
export function markBusy(state: RotationState, id: string, busy: boolean): RotationState {
  return { ...state, [id]: { ...entryOf(state, id), busy } };
}

/**
 * A request came back. `saved` moves to what the server now holds — not to `shown`,
 * which may have moved again while we were waiting.
 */
export function settle(state: RotationState, id: string, applied: number): RotationState {
  const entry = entryOf(state, id);
  return {
    ...state,
    [id]: { ...entry, saved: normalise(entry.saved + applied), busy: false },
  };
}

/**
 * A request failed: the photo on disk is whatever `saved` already said, so the
 * preview has to go back to it rather than keep showing a turn that never happened.
 */
export function rollBack(state: RotationState, id: string): RotationState {
  const entry = entryOf(state, id);
  return { ...state, [id]: { ...entry, shown: entry.saved, busy: false } };
}

/** True while anything at all is still being saved. */
export function isSettling(state: RotationState): boolean {
  return Object.values(state).some(
    (entry) => entry.busy || normalise(entry.shown - entry.saved) !== 0
  );
}

/** Ids whose preview is ahead of the server, in no particular order. */
export function outstanding(state: RotationState): string[] {
  return Object.keys(state).filter((id) => pendingRequest(state, id) !== null);
}

/** Drop everything: a new batch, or a screen being left. */
export function clearTurns(): RotationState {
  return {};
}
