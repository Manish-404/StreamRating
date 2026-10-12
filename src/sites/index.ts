import { netflix } from './netflix';
import type { SiteAdapter } from './types';
import { youtube } from './youtube';

export const ADAPTERS: SiteAdapter[] = [netflix, youtube];

export function adapterFor(url: URL): SiteAdapter | undefined {
  return ADAPTERS.find((a) => a.matches(url));
}
