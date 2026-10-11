import { netflix } from './netflix';
import type { SiteAdapter } from './types';

export const ADAPTERS: SiteAdapter[] = [netflix];

export function adapterFor(url: URL): SiteAdapter | undefined {
  return ADAPTERS.find((a) => a.matches(url));
}
