export type Tone = 'good' | 'mid' | 'bad';

/** Colour band for an IMDb-style 0-10 score. */
export const outOfTenTone = (score: number): Tone => (score >= 7.5 ? 'good' : score >= 6 ? 'mid' : 'bad');

/** Colour band for a 0-100 score (Rotten Tomatoes, Metacritic). */
export const percentTone = (score: number): Tone => (score >= 75 ? 'good' : score >= 60 ? 'mid' : 'bad');

export function formatVotes(n: number | null): string {
  if (n === null) return '';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return Math.round(n / 1_000) + 'K';
  return String(n);
}

export function formatRuntime(min?: number): string {
  if (!min) return '';
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h ? h + 'h ' + m + 'm' : m + 'm';
}
