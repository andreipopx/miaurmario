/**
 * Rotating a batch of photos used to be a sequence of little waits: one turn had to
 * reach the server before the next could start. These pin the arithmetic that makes
 * it feel instant — chiefly that turns add up, so taps made while a request is in
 * the air are settled by the next one and a turn the user undid is never sent.
 */

import { describe, expect, it } from 'vitest';

import {
  applyTurn,
  clearTurns,
  entryOf,
  isSettling,
  markBusy,
  normalise,
  outstanding,
  pendingRequest,
  rollBack,
  settle,
  turnsShown,
  turnsPending,
  type RotationState,
} from '@/lib/rotation-queue';

const A = 'garment-a';
const B = 'garment-b';

describe('normalise', () => {
  it('brings any count of turns into 0-3, in either direction', () => {
    expect(normalise(0)).toBe(0);
    expect(normalise(4)).toBe(0);
    expect(normalise(5)).toBe(1);
    expect(normalise(-1)).toBe(3);
    expect(normalise(-5)).toBe(3);
  });
});

describe('what the preview shows', () => {
  it('moves the moment the button is tapped', () => {
    const state = applyTurn(clearTurns(), A, 'cw');
    expect(turnsShown(state, A)).toBe(1);
    // Nothing has been saved yet, and it says so.
    expect(entryOf(state, A).saved).toBe(0);
  });

  it('a photo nobody has touched is simply upright', () => {
    expect(turnsShown(clearTurns(), A)).toBe(0);
    expect(entryOf(clearTurns(), A)).toEqual({ shown: 0, saved: 0, busy: false });
  });

  it('keeps each photo\'s turns to itself', () => {
    let state: RotationState = clearTurns();
    state = applyTurn(state, A, 'cw');
    state = applyTurn(state, B, 'ccw');
    expect(turnsShown(state, A)).toBe(1);
    expect(turnsShown(state, B)).toBe(3);
  });
});

describe('what gets sent', () => {
  it('collapses three taps into one request', () => {
    let state: RotationState = clearTurns();
    state = applyTurn(state, A, 'cw');
    state = applyTurn(state, A, 'cw');
    state = applyTurn(state, A, 'cw');
    // Three quarters clockwise is one quarter anticlockwise: the shortest way round.
    expect(pendingRequest(state, A)).toEqual({ direction: 'ccw', quarters: 1 });
  });

  it('collapses two taps into a single half turn', () => {
    let state: RotationState = clearTurns();
    state = applyTurn(state, A, 'cw');
    state = applyTurn(state, A, 'cw');
    expect(pendingRequest(state, A)).toEqual({ direction: 'cw', quarters: 2 });
  });

  it('sends nothing at all when the user ends up where they started', () => {
    let state: RotationState = clearTurns();
    state = applyTurn(state, A, 'cw');
    state = applyTurn(state, A, 'ccw');
    expect(pendingRequest(state, A)).toBeNull();

    let round: RotationState = clearTurns();
    for (let i = 0; i < 4; i += 1) round = applyTurn(round, A, 'cw');
    expect(pendingRequest(round, A)).toBeNull();
  });

  it('sends nothing while that photo already has a request in the air', () => {
    let state: RotationState = applyTurn(clearTurns(), A, 'cw');
    state = markBusy(state, A, true);
    expect(pendingRequest(state, A)).toBeNull();
  });

  it('lets a different photo go in parallel', () => {
    let state: RotationState = clearTurns();
    state = markBusy(applyTurn(state, A, 'cw'), A, true);
    state = applyTurn(state, B, 'cw');
    expect(outstanding(state)).toEqual([B]);
  });
});

describe('when a request comes back', () => {
  it('records what the server stored, not what is on screen', () => {
    let state: RotationState = applyTurn(clearTurns(), A, 'cw');
    state = markBusy(state, A, true);
    // The user keeps tapping while we wait.
    state = applyTurn(state, A, 'cw');
    state = settle(state, A, 1);

    expect(turnsShown(state, A)).toBe(2);
    expect(entryOf(state, A).saved).toBe(1);
    // So one more turn is still owed, and it is the only one owed.
    expect(pendingRequest(state, A)).toEqual({ direction: 'cw', quarters: 1 });
  });

  it('is finished when the two agree', () => {
    let state: RotationState = applyTurn(clearTurns(), A, 'cw');
    state = settle(state, A, 1);
    expect(pendingRequest(state, A)).toBeNull();
    expect(isSettling(state)).toBe(false);
  });

  it('settles an anticlockwise turn', () => {
    let state: RotationState = applyTurn(clearTurns(), A, 'ccw');
    state = settle(state, A, -1);
    expect(entryOf(state, A).saved).toBe(3);
    expect(pendingRequest(state, A)).toBeNull();
  });
});

describe('when a save fails', () => {
  it('puts the preview back to what is really on disk', () => {
    let state: RotationState = applyTurn(clearTurns(), A, 'cw');
    state = settle(state, A, 1);
    // A second turn that the server refuses.
    state = markBusy(applyTurn(state, A, 'cw'), A, true);
    state = rollBack(state, A);

    // Back to the one turn that did save — not to upright, and not to two.
    expect(turnsShown(state, A)).toBe(1);
    expect(entryOf(state, A).busy).toBe(false);
    expect(pendingRequest(state, A)).toBeNull();
  });

  it('leaves other photos alone', () => {
    let state: RotationState = clearTurns();
    state = applyTurn(state, A, 'cw');
    state = applyTurn(state, B, 'cw');
    state = rollBack(state, A);
    expect(turnsShown(state, B)).toBe(1);
  });
});

describe('settling', () => {
  it('is true while anything is outstanding and false once it is all stored', () => {
    let state: RotationState = applyTurn(clearTurns(), A, 'cw');
    expect(isSettling(state)).toBe(true);
    state = markBusy(state, A, true);
    expect(isSettling(state)).toBe(true);
    state = settle(state, A, 1);
    expect(isSettling(state)).toBe(false);
  });

  it('is false for turns that cancelled each other out', () => {
    let state: RotationState = applyTurn(clearTurns(), A, 'cw');
    state = applyTurn(state, A, 'ccw');
    expect(isSettling(state)).toBe(false);
  });
});

describe('what the preview adds on top of the stored file', () => {
  it('drops back to zero once the turn is saved, so nothing is shown turned twice', () => {
    let state = applyTurn(clearTurns(), A, 'cw');
    expect(turnsPending(state, A)).toBe(1);

    state = markBusy(state, A, true);
    state = settle(state, A, 1); // the server now stores the rotated file
    expect(turnsPending(state, A)).toBe(0);
    expect(turnsShown(state, A)).toBe(1);
  });

  it('keeps showing only the turns still in flight when the user taps again', () => {
    let state = applyTurn(clearTurns(), A, 'cw');
    state = markBusy(state, A, true);
    state = applyTurn(state, A, 'cw'); // tapped again while saving
    state = settle(state, A, 1);
    expect(turnsPending(state, A)).toBe(1);
  });

  it('shows nothing extra after a failed save rolls the preview back', () => {
    let state = applyTurn(clearTurns(), A, 'cw');
    state = rollBack(state, A);
    expect(turnsPending(state, A)).toBe(0);
  });
});
