import type { TitleInfo } from '../match/types';

export type BadgeState =
  | { status: 'loading' }
  | { status: 'ready'; info: TitleInfo }
  | { status: 'error'; kind: 'missing_key' | 'quota' | 'api' | 'network'; message: string }
  | { status: 'none' };
