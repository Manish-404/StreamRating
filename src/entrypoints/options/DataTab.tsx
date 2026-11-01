import { useRef, useState } from 'preact/hooks';
import { backupFileName, exportBackup, importBackup, parseBackup } from '../../db/backup';
import { countUserData } from '../../db/userData';
import { useLive } from './useLive';

export function DataTab() {
  const counts = useLive(countUserData);
  const picker = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string }>();

  async function save() {
    const backup = await exportBackup();
    const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: backupFileName() });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    setMessage({ ok: true, text: 'Saved ' + a.download + ' to your downloads.' });
  }

  async function load(file: File | undefined) {
    if (!file) return;
    try {
      const r = await importBackup(parseBackup(await file.text()));
      setMessage({ ok: true, text: 'Imported: ' + r.added + ' new, ' + r.updated + ' updated, ' + r.kept + ' already up to date here.' });
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : String(e) });
    }
    if (picker.current) picker.current.value = '';
  }

  return (
    <section>
      <h2>Your data</h2>
      <p class="muted">
        Your watchlist and history live only in this browser{counts ? ' (' + counts.watchlist + ' on the watchlist, ' + counts.watched + ' titles watched)' : ''}.
        Uninstalling the extension, clearing its data or deleting the browser profile erases them. Save a backup now and then,
        and use it to bring your lists to another browser or device.
      </p>
      <div class="filters">
        <button class="primary" onClick={() => void save()}>Export backup</button>
        <button class="primary" onClick={() => picker.current?.click()}>Import backup</button>
        <input ref={picker} type="file" accept=".json,application/json" hidden onChange={(e) => void load(e.currentTarget.files?.[0])} />
      </div>
      {message && (
        <p role="status" class={message.ok ? 'ok' : 'bad'}>
          {message.text}
        </p>
      )}
      <p class="muted small">
        Importing merges: for each title the newer change wins, so nothing newer on this device is overwritten. The backup holds
        history, watchlist and your corrections. It does not contain your API keys or settings.
      </p>
    </section>
  );
}
