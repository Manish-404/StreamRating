import { NeedsReconnect } from './googleAuth';

/** One file in the user's Drive that holds the data, and the two things the sync needs to do with it. */
export interface SyncTarget {
  /** The file's text, or null when it does not exist yet. */
  read(): Promise<string | null>;
  write(text: string): Promise<void>;
}

export const DRIVE_FILE_NAME = 'streamrating-data.json';
const API = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';

export class DriveError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'DriveError';
  }
}

/** Turns Google's error reply into something the user can act on. */
async function failure(res: Response): Promise<Error> {
  let reason = '';
  let message = '';
  try {
    const body = (await res.json()) as { error?: { message?: string; errors?: Array<{ reason?: string }> } };
    message = body.error?.message ?? '';
    reason = body.error?.errors?.[0]?.reason ?? '';
  } catch {
    /* not JSON */
  }
  if (res.status === 401) return new NeedsReconnect();
  if (res.status === 403 && /accessNotConfigured|has not been used|is disabled/i.test(reason + ' ' + message)) {
    return new DriveError(403, 'The Google Drive API is switched off in your Google Cloud project. Enable it there (step 2 of the setup), then try again.');
  }
  if (res.status === 403 && /rateLimit|quota/i.test(reason + message)) return new DriveError(403, 'Google Drive is limiting requests right now. It will try again later.');
  return new DriveError(res.status, 'Google Drive answered ' + res.status + (message ? ': ' + message : '') + '.');
}

/** The sync file in Drive. `token` is asked for on every call, so an expired one is renewed in between. */
export function createDriveTarget(token: () => Promise<string>, fetchFn: typeof fetch = (...a) => fetch(...a)): SyncTarget {
  let fileId: string | null | undefined;

  const call = async (url: string, init: RequestInit = {}) => {
    const res = await fetchFn(url, { ...init, headers: { ...init.headers, Authorization: 'Bearer ' + (await token()) } });
    if (!res.ok) throw await failure(res);
    return res;
  };

  /** drive.file only lists files this extension made, so the name is enough. The oldest wins if two devices both created one. */
  async function find(): Promise<string | null> {
    if (fileId !== undefined) return fileId;
    const q = "name = '" + DRIVE_FILE_NAME + "' and trashed = false";
    const res = await call(API + '?' + new URLSearchParams({ q, orderBy: 'createdTime', pageSize: '1', fields: 'files(id)', spaces: 'drive' }));
    const body = (await res.json()) as { files?: Array<{ id: string }> };
    return (fileId = body.files?.[0]?.id ?? null);
  }

  return {
    async read() {
      const id = await find();
      if (!id) return null;
      return (await call(API + '/' + encodeURIComponent(id) + '?alt=media')).text();
    },
    async write(text) {
      const id = await find();
      if (id) {
        await call(UPLOAD + '/' + encodeURIComponent(id) + '?uploadType=media', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: text });
        return;
      }
      const boundary = 'streamrating' + Math.random().toString(36).slice(2);
      const body =
        '--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' +
        JSON.stringify({ name: DRIVE_FILE_NAME, mimeType: 'application/json' }) +
        '\r\n--' + boundary + '\r\nContent-Type: application/json\r\n\r\n' + text + '\r\n--' + boundary + '--';
      const res = await call(UPLOAD + '?uploadType=multipart&fields=id', { method: 'POST', headers: { 'Content-Type': 'multipart/related; boundary=' + boundary }, body });
      fileId = ((await res.json()) as { id: string }).id;
    },
  };
}
