import { sendMessage } from '../messaging/protocol';

/** Tells the background that the dashboard changed the user's data, so it syncs soon. A missing answer is not an error. */
export const syncSoon = () => void sendMessage('syncSoon').catch(() => {});
