import type { TitleInfo } from '../match/types';

export type BadgeState =
  | { status: 'loading' }
  | { status: 'ready'; info: TitleInfo }
  | { status: 'error'; kind: 'missing_key' | 'quota' | 'api' | 'network'; message: string }
  | { status: 'none' }
  /** A video whose title reads as a film that no database lists: a re-titled dub, a compilation, or not a film. */
  | { status: 'unlisted' };
