import { useEffect, useState } from 'preact/hooks';
import type { OmdbEpisode } from '../api/omdb';
import type { TitleInfo } from '../match/types';
import { sendMessage } from '../messaging/protocol';
import type { EpisodeResult } from '../services/episodeInfo';
import { Loading, Review, useLatestReview } from './HoverCard';
import { formatRuntime, outOfTenTone } from './format';

export interface EpisodeCardProps {
  info: TitleInfo;
  season: number;
  ep: OmdbEpisode;
}

/** The pop-up for one episode: its plot and scores, and the latest review of the series it belongs to. */
export function EpisodeCard({ info, season, ep }: EpisodeCardProps) {
  const [detail, setDetail] = useState<EpisodeResult | 'loading'>('loading');
  const [still, setStill] = useState<string | null>(null);
  const review = useLatestReview(info.type, info.tmdbId);

  useEffect(() => {
    setDetail('loading');
    setStill(null);
    let live = true;
    sendMessage('getEpisode', { tmdbId: info.tmdbId, season, episode: ep.episode })
      .then((r) => {
        if (!live) return;
        setDetail(r ?? { status: 'error' });
        if (r?.status === 'ok' && r.episode.stillPath) {
          sendMessage('getPoster', r.episode.stillPath)
            .then((url) => live && setStill(url))
            .catch(() => {});
        }
      })
      .catch(() => live && setDetail({ status: 'error' }));
    return () => {
      live = false;
    };
  }, [info.tmdbId, season, ep.episode]);

  const d = detail !== 'loading' && detail.status === 'ok' ? detail.episode : null;
  const aired = d?.airDate ?? ep.released;
  const meta = [info.title, 'S' + season + ' \u00b7 E' + ep.episode, aired, formatRuntime(d?.runtimeMin ?? undefined)].filter(Boolean).join(' \u00b7 ');

  return (
    <div class="card">
      {still && <img class="still" src={still} alt="" />}
      <h3>{ep.title || 'Episode ' + ep.episode}</h3>
      <div class="meta">{meta}</div>
      <div class="scores">
        {ep.imdbRating !== null && <div class={'score imdb ' + outOfTenTone(ep.imdbRating)}><div class="score-value">{ep.imdbRating.toFixed(1)}</div><div class="score-label">IMDb</div></div>}
        {d?.tmdbRating != null && <div class="score tmdb plain"><div class="score-value">{d.tmdbRating.toFixed(1)}</div><div class="score-label">TMDB</div></div>}
      </div>
      {d?.overview && <p class="overview">{d.overview}</p>}
      {detail === 'loading' && <Loading>Loading episode details…</Loading>}
      <Review result={review} heading="Latest review of the series" />
      <p class="review-note">TMDB has no reviews for single episodes, so this is about the whole series.</p>
    </div>
  );
}
