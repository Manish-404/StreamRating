import { browser } from 'wxt/browser';
import { storage } from 'wxt/utils/storage';

/** Only files this extension created: Drive shows it nothing else. A non-sensitive scope, so Google needs no app review. */
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

interface Token {
  accessToken: string;
  /** Epoch ms. */
  expiresAt: number;
}

const tokenItem = storage.defineItem<Token | null>('local:googleToken', { fallback: null });

/** Google no longer accepts the saved sign-in: the user has to press Connect again. */
export class NeedsReconnect extends Error {
  constructor(message = 'Google needs you to sign in again.') {
    super(message);
    this.name = 'NeedsReconnect';
  }
}

/** The address Google sends the browser back to. The user registers exactly this in their Google Cloud project. */
export const redirectUri = () => browser.identity.getRedirectURL();

export function authUrl(clientId: string, redirect: string, interactive: boolean): string {
  const q = new URLSearchParams({
    client_id: clientId,
    response_type: 'token',
    redirect_uri: redirect,
    scope: DRIVE_SCOPE,
    // Without a window to ask in, Google must answer at once or say that it needs one.
    ...(interactive ? {} : { prompt: 'none' }),
  });
  return 'https://accounts.google.com/o/oauth2/v2/auth?' + q;
}

/** Reads the address Google redirected to: the token sits in the part after `#`. Throws with Google's own reason. */
export function parseAuthResponse(redirected: string, now = Date.now()): Token {
  const url = new URL(redirected);
  const p = new URLSearchParams(url.hash.replace(/^#/, '') || url.search);
  const error = p.get('error');
  if (error) throw new NeedsReconnect('Google refused the sign-in (' + error + ').');
  const accessToken = p.get('access_token');
  if (!accessToken) throw new NeedsReconnect('Google did not return an access token.');
  const seconds = Number(p.get('expires_in')) || 3600;
  return { accessToken, expiresAt: now + seconds * 1000 };
}

export type AuthFlow = (url: string, interactive: boolean) => Promise<string | undefined>;

const browserFlow: AuthFlow = (url, interactive) => browser.identity.launchWebAuthFlow({ url, interactive });

/**
 * A valid access token. Tokens last an hour; the saved one is reused, and a new one is asked for without a window
 * (it works while Google still remembers the grant). `interactive` opens Google's sign-in window: only for the
 * Connect button. Throws NeedsReconnect when a window would be needed.
 */
export async function getAccessToken(
  clientId: string,
  interactive: boolean,
  { now = Date.now(), flow = browserFlow, redirect = redirectUri() }: { now?: number; flow?: AuthFlow; redirect?: string } = {},
): Promise<string> {
  const saved = await tokenItem.getValue();
  if (saved && saved.expiresAt - 60_000 > now && !interactive) return saved.accessToken;
  if (!clientId.trim()) throw new NeedsReconnect('Paste your Google client ID first.');
  let redirected: string | undefined;
  try {
    redirected = await flow(authUrl(clientId.trim(), redirect, interactive), interactive);
  } catch (e) {
    throw new NeedsReconnect(interactive ? (e instanceof Error ? e.message : String(e)) : 'Google needs you to sign in again.');
  }
  if (!redirected) throw new NeedsReconnect();
  const token = parseAuthResponse(redirected, now);
  await tokenItem.setValue(token);
  return token.accessToken;
}

export const forgetToken = () => tokenItem.removeValue();
