/** What Stinky does when petted (tap/click/Enter/Space). */
export type StinkyPetReaction = 'purr' | 'bite'

/** Share of pets answered with a playful bite (the rest purr). */
export const STINKY_BITE_CHANCE = 0.35
/** Never more than this many bites in a row. */
export const STINKY_MAX_BITES_IN_A_ROW = 2

/**
 * Pick the reaction to a pet: ~65% purr / ~35% bite, never three bites in a row.
 * `history` is the list of previous reactions (most recent last); `random` is injectable for tests.
 */
export function pickPetReaction(
  history: readonly StinkyPetReaction[],
  random: () => number = Math.random,
): StinkyPetReaction {
  const recent = history.slice(-STINKY_MAX_BITES_IN_A_ROW)
  if (recent.length === STINKY_MAX_BITES_IN_A_ROW && recent.every(r => r === 'bite')) return 'purr'
  return random() < STINKY_BITE_CHANCE ? 'bite' : 'purr'
}

/** Haptic patterns (navigator.vibrate) per reaction. */
export const STINKY_PET_VIBRATION: Readonly<Record<StinkyPetReaction, readonly number[]>> = {
  purr: [15, 30, 15, 30, 15, 30, 15],
  bite: [20, 40, 20],
}
