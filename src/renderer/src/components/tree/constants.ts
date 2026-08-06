/**
 * Fixed tree row height in px. Load-bearing: the review screen's connector
 * overlay computes row y-positions as `index * ROW_HEIGHT - scrollOffset`
 * without touching the DOM, which only works if every row is exactly this
 * tall. Never make row height content-dependent.
 */
export const ROW_HEIGHT = 28
