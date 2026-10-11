import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import { omdb, omdbQuota, tmdb } from '../api';
import { fetchPosterDataUrl } from '../api/poster';
import { testKeys } from '../api/testKeys';
import { onMessage } from '../messaging/protocol';
import { createLookup } from '../services/lookup';
import { createEpisodeInfo } from '../services/episodeInfo';
import { createReviews } from '../services/reviews';
import { createSeasons } from '../services/seasons';

export default defineBackground(() => {
  const lookup = createLookup({ tmdb, omdb });
  const getSeason = createSeasons({ omdb });
  const getLatestReview = createReviews({ tmdb });
  const getEpisode = createEpisodeInfo({ tmdb });

  onMessage('testKeys', () => testKeys(tmdb, omdb));
  onMessage('getQuota', () => omdbQuota.usage());
  onMessage('lookupTitle', ({ data }) => lookup(data));
  onMessage('getPoster', ({ data }) => fetchPosterDataUrl(data));
  onMessage('getSeason', ({ data }) => getSeason(data.imdbId, data.season));
  onMessage('getLatestReview', ({ data }) => getLatestReview(data.type, data.tmdbId));
  onMessage('getEpisode', ({ data }) => getEpisode(data.tmdbId, data.season, data.episode));
  onMessage('openSettings', () => browser.runtime.openOptionsPage());
});
