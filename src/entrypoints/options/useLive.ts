import { liveQuery } from 'dexie';
import { useEffect, useState } from 'preact/hooks';

/**
 * The result of a database query, kept up to date as the data changes (the background saves a watch while this page
 * is open). Undefined until the first answer. Also asks again when the window gets focus, in case a change made in
 * another part of the extension did not announce itself.
 */
export function useLive<T>(query: () => Promise<T>): T | undefined {
  const [value, setValue] = useState<T>();
  useEffect(() => {
    let live = true;
    const sub = liveQuery(query).subscribe({ next: (v) => live && setValue(v), error: () => {} });
    const again = () => void query().then((v) => live && setValue(v)).catch(() => {});
    window.addEventListener('focus', again);
    return () => {
      live = false;
      sub.unsubscribe();
      window.removeEventListener('focus', again);
    };
  }, []);
  return value;
}
