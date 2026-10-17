import { defineConfig } from 'wxt';
import preact from '@preact/preset-vite';

export default defineConfig({
  srcDir: 'src',
  // The sources zip goes to Mozilla for review: keep private notes, scratch files and the website (docs/) out of it.
  zip: { excludeSources: ['c*-notes/**', '.tmp/**', '.output/**', '.env*', 'docs/**'] },
  vite: () => ({
    plugins: [preact()],
    define: { __BUILD_TIME__: JSON.stringify(new Date().toISOString()) },
  }),
  manifest: ({ browser }) => ({
    name: 'StreamRating',
    description:
      'IMDb, OMDb, TMDB and Rotten Tomatoes video ratings on Netflix and YouTube, with review summaries, watch history and recommendations.',
    permissions: [
      'storage',
      'unlimitedStorage',
      'alarms',
      'scripting',
      'identity',
      // Firefox has no folder picker, so the local-folder backup is written through the downloads API.
      ...(browser === 'firefox' ? ['downloads'] : []),
    ],
    host_permissions: [
      'https://api.themoviedb.org/*',
      'https://image.tmdb.org/*',
      'https://www.omdbapi.com/*',
      'https://www.imdb.com/*',
      'https://www.rottentomatoes.com/*',
      'https://kids-in-mind.com/*',
      'https://www.googleapis.com/*',
    ],
    ...(browser === 'firefox'
      ? {
          browser_specific_settings: {
            gecko: {
              // A UUID, because addons.mozilla.org reserves the id of a deleted add-on forever. Do not change it once published.
              id: '{bb59ce10-aed6-4b2d-aca9-9eae7661f0e1}',
              strict_min_version: '140.0',
              // Titles you browse are sent to TMDB and OMDb to look up ratings; nothing else leaves the browser.
              data_collection_permissions: { required: ['browsingActivity'] },
            },
            // Firefox for Android only understands data_collection_permissions from version 142.
            gecko_android: { strict_min_version: '142.0' },
          },
        }
      : {}),
  }),
});
