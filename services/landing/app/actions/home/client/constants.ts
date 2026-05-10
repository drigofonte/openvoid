/**
 * Shared constants for the Create-page composer clientEntries.
 *
 * Keeping the prompt-length threshold here instead of hard-coded
 * in each clientEntry preserves the UX coupling: the slug ghost
 * line fades in at the same threshold the submit button enables.
 * The server-side schema (`CreateSchema` in `controller.tsx`)
 * uses `minLength(1)` — the 8-char threshold is a UX gate, not a
 * validation gate, so server logic stays separate.
 */

export const PROMPT_MIN_LENGTH = 8
